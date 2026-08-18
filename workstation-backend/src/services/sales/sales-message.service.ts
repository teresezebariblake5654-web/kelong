import type { SalesChannel, SalesConversation, SalesMessage } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/errors';
import { emailChannelGateway } from '../../providers/sales-channels/email.gateway';
import { whatsappChannelGateway } from '../../providers/sales-channels/whatsapp.gateway';
import { env } from '../../config/env';
import { enqueueSalesOutboundJob } from '../../queues/sales-outbound.queue';
import { recordSalesActivity } from './sales-activity.service';
import { requireProspect } from './sales-prospect.service';
import { normalizePhoneDigits } from '../leads/lead-phone.service';
import { assertOrgOutboundRateAllowed } from './sales-outbound-rate.service';
import { isAutoSendBlockedStatus } from './sales-agent.types';

export function toMessageDto(row: SalesMessage) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    conversationId: row.conversationId,
    direction: row.direction,
    channel: row.channel,
    status: row.status,
    from: row.fromAddress,
    to: row.toAddress,
    subject: row.subject,
    content: row.content,
    providerMessageId: row.providerMessageId,
    sentAt: row.sentAt?.toISOString() ?? null,
    receivedAt: row.receivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getOrCreateConversation(params: {
  organizationId: string;
  prospectId: string;
  channel: SalesChannel;
  externalThreadId?: string | null;
}): Promise<SalesConversation> {
  const existing = await prisma.salesConversation.findUnique({
    where: {
      organizationId_prospectId_channel: {
        organizationId: params.organizationId,
        prospectId: params.prospectId,
        channel: params.channel,
      },
    },
  });
  if (existing) {
    if (params.externalThreadId && !existing.externalThreadId) {
      return prisma.salesConversation.update({
        where: { id: existing.id },
        data: { externalThreadId: params.externalThreadId },
      });
    }
    return existing;
  }
  return prisma.salesConversation.create({
    data: {
      organizationId: params.organizationId,
      prospectId: params.prospectId,
      channel: params.channel,
      externalThreadId: params.externalThreadId || null,
    },
  });
}

function assertChannelConfigured(channel: SalesChannel): void {
  if (channel === 'EMAIL' && !emailChannelGateway.isConfigured()) {
    throw new AppError(503, 'Email 通道未配置', 'CHANNEL_NOT_CONFIGURED');
  }
  if (channel === 'WHATSAPP' && !whatsappChannelGateway.isConfigured()) {
    throw new AppError(503, 'WhatsApp 通道未配置', 'CHANNEL_NOT_CONFIGURED');
  }
}

function resolveRecipient(params: {
  channel: SalesChannel;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
}): { to: string; from: string } {
  if (params.channel === 'EMAIL') {
    const to = params.email?.trim();
    if (!to) {
      throw new AppError(400, '该联系人没有邮箱', 'CONTACT_EMAIL_REQUIRED');
    }
    const from = env.salesEmailFrom || env.mailFrom;
    return { to, from };
  }
  const raw = params.whatsapp || params.phone || '';
  const digits = normalizePhoneDigits(raw);
  if (digits.length < 7) {
    throw new AppError(400, '该联系人没有可用电话', 'CONTACT_PHONE_REQUIRED');
  }
  return { to: digits, from: env.whatsappPhoneNumberId };
}

export async function queueOutboundMessage(params: {
  organizationId: string;
  prospectId: string;
  channel: SalesChannel;
  subject?: string;
  content: string;
  idempotencyKey?: string;
}) {
  const content = params.content.trim();
  if (!content) {
    throw new AppError(400, 'content 必填', 'BAD_REQUEST');
  }
  if (params.channel === 'EMAIL' && !(params.subject || '').trim()) {
    throw new AppError(400, 'Email 需要 subject', 'BAD_REQUEST');
  }
  assertChannelConfigured(params.channel);

  const prospect = await requireProspect({
    organizationId: params.organizationId,
    prospectId: params.prospectId,
  });

  if (isAutoSendBlockedStatus(prospect.status)) {
    throw new AppError(409, `终态 ${prospect.status} 禁止发送`, 'PROSPECT_TERMINAL_STATUS');
  }

  await assertOrgOutboundRateAllowed(params.organizationId);

  if (params.idempotencyKey) {
    const prior = await prisma.salesMessage.findFirst({
      where: { organizationId: params.organizationId, idempotencyKey: params.idempotencyKey },
    });
    if (prior) {
      return { message: toMessageDto(prior), duplicated: true };
    }
  }

  if (!prospect.leadContactId) {
    throw new AppError(400, '销售线索没有联系人', 'LEAD_CONTACT_REQUIRED');
  }
  const contact = await prisma.leadContact.findUnique({
    where: { id: prospect.leadContactId },
  });
  if (!contact || contact.organizationId !== params.organizationId) {
    throw new AppError(404, '联系人不存在', 'LEAD_CONTACT_NOT_FOUND');
  }

  const recipient = resolveRecipient({
    channel: params.channel,
    email: contact.emailNormalized || contact.email,
    phone: contact.phone,
    whatsapp: contact.whatsapp,
  });

  const conversation = await getOrCreateConversation({
    organizationId: params.organizationId,
    prospectId: prospect.id,
    channel: params.channel,
    externalThreadId: params.channel === 'WHATSAPP' ? recipient.to : null,
  });

  const message = await prisma.salesMessage.create({
    data: {
      organizationId: params.organizationId,
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      channel: params.channel,
      status: 'QUEUED',
      fromAddress: recipient.from || null,
      toAddress: recipient.to,
      subject: params.channel === 'EMAIL' ? params.subject?.trim() || null : null,
      content,
      idempotencyKey: params.idempotencyKey || null,
    },
  });

  await recordSalesActivity({
    organizationId: params.organizationId,
    prospectId: prospect.id,
    type: 'MESSAGE_QUEUED',
    payload: { messageId: message.id, channel: params.channel },
  });

  try {
    await enqueueSalesOutboundJob({
      messageId: message.id,
      organizationId: params.organizationId,
      prospectId: prospect.id,
      channel: params.channel,
    });
  } catch (err) {
    await prisma.salesMessage.update({
      where: { id: message.id },
      data: {
        status: 'FAILED',
        providerMetadata: {
          error: err instanceof Error ? err.message : String(err),
        },
      },
    });
    await recordSalesActivity({
      organizationId: params.organizationId,
      prospectId: prospect.id,
      type: 'MESSAGE_FAILED',
      payload: { messageId: message.id, channel: params.channel },
    });
    throw new AppError(503, '销售发送队列不可用', 'SALES_QUEUE_UNAVAILABLE');
  }

  return { message: toMessageDto(message), duplicated: false };
}

export async function listProspectMessages(params: {
  organizationId: string;
  prospectId: string;
}) {
  await requireProspect(params);
  const conversations = await prisma.salesConversation.findMany({
    where: { organizationId: params.organizationId, prospectId: params.prospectId },
    select: { id: true },
  });
  const ids = conversations.map((c) => c.id);
  const rows = await prisma.salesMessage.findMany({
    where: { organizationId: params.organizationId, conversationId: { in: ids } },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
  return { messages: rows.map(toMessageDto) };
}

export { requireProspect };
