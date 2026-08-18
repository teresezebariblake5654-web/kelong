import type { SalesChannel } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/errors';
import { emailChannelGateway } from '../../providers/sales-channels/email.gateway';
import { whatsappChannelGateway } from '../../providers/sales-channels/whatsapp.gateway';
import { recordSalesActivity } from './sales-activity.service';
import { transitionProspectStatus } from './sales-prospect.service';
import { toMessageDto } from './sales-message.service';

export async function markOutboundMessageFailed(params: {
  messageId: string;
  organizationId: string;
  error: unknown;
}): Promise<void> {
  const message = await prisma.salesMessage.findUnique({
    where: { id: params.messageId },
    include: { conversation: true },
  });
  if (!message || message.organizationId !== params.organizationId) return;
  // Never downgrade SENT/DELIVERED/RECEIVED to FAILED on retry/restart races.
  if (message.status === 'SENT' || message.status === 'DELIVERED' || message.status === 'RECEIVED') {
    return;
  }
  await prisma.salesMessage.update({
    where: { id: message.id },
    data: {
      status: 'FAILED',
      providerMetadata: {
        error: params.error instanceof Error ? params.error.message : String(params.error),
        code: params.error instanceof AppError ? params.error.code : undefined,
      },
    },
  });
  await recordSalesActivity({
    organizationId: message.organizationId,
    prospectId: message.conversation.prospectId,
    type: 'MESSAGE_FAILED',
    payload: { messageId: message.id, channel: message.channel as SalesChannel },
  });
}

export async function deliverQueuedMessage(params: {
  messageId: string;
  organizationId: string;
  /** When false, leave QUEUED on transient failure so BullMQ can retry. Default false for worker. */
  markFailedOnError?: boolean;
}) {
  const message = await prisma.salesMessage.findUnique({
    where: { id: params.messageId },
    include: { conversation: true },
  });
  if (!message) {
    throw new AppError(404, '消息不存在', 'SALES_MESSAGE_NOT_FOUND');
  }
  if (message.organizationId !== params.organizationId) {
    throw new AppError(403, '无权发送该消息', 'ORGANIZATION_MISMATCH');
  }
  if (message.direction !== 'OUTBOUND') {
    return { message: toMessageDto(message) };
  }
  if (message.status === 'SENT' || message.status === 'DELIVERED') {
    return { message: toMessageDto(message) };
  }
  if (message.status === 'FAILED' && params.markFailedOnError === false) {
    // Allow worker retries after transient earlier marks; only skip if permanently failed intentionally.
  }

  const gateway = message.channel === 'EMAIL' ? emailChannelGateway : whatsappChannelGateway;
  try {
    const sent = await gateway.sendMessage({
      to: message.toAddress || '',
      content: message.content,
      subject: message.subject || undefined,
      from: message.fromAddress || undefined,
    });

    let updated;
    try {
      updated = await prisma.salesMessage.update({
        where: { id: message.id },
        data: {
          status: 'SENT',
          providerMessageId: sent.providerMessageId,
          providerMetadata: (sent.providerMetadata ?? {}) as Prisma.InputJsonValue,
          sentAt: new Date(),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await prisma.salesMessage.findFirst({
          where: {
            organizationId: message.organizationId,
            channel: message.channel,
            providerMessageId: sent.providerMessageId,
          },
        });
        if (existing) return { message: toMessageDto(existing) };
      }
      throw err;
    }

    await prisma.salesConversation.update({
      where: { id: message.conversationId },
      data: { lastMessageAt: updated.sentAt },
    });
    await recordSalesActivity({
      organizationId: message.organizationId,
      prospectId: message.conversation.prospectId,
      type: 'MESSAGE_SENT',
      payload: {
        messageId: message.id,
        channel: message.channel,
        providerMessageId: sent.providerMessageId,
      },
    });
    await transitionProspectStatus({
      organizationId: message.organizationId,
      prospectId: message.conversation.prospectId,
      next: 'CONTACTED',
    });
    return { message: toMessageDto(updated) };
  } catch (err) {
    if (params.markFailedOnError !== false) {
      await markOutboundMessageFailed({
        messageId: message.id,
        organizationId: message.organizationId,
        error: err,
      });
    }
    throw err;
  }
}
