import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { normalizePhoneDigits } from '../leads/lead-phone.service';
import { enqueueSalesAgentRun } from '../../queues/sales-agent.queue';
import { recordSalesActivity } from './sales-activity.service';
import { getOrCreateConversation, toMessageDto } from './sales-message.service';
import { transitionProspectStatus } from './sales-prospect.service';

export type InboundEmailPayload = {
  from: string;
  to?: string;
  subject?: string;
  content: string;
  providerMessageId: string;
  threadId?: string;
};

export async function ingestInboundMessage(params: {
  organizationId: string;
  prospectId: string;
  channel: 'EMAIL' | 'WHATSAPP';
  from: string;
  to?: string;
  subject?: string;
  content: string;
  providerMessageId: string;
  externalThreadId?: string;
}) {
  if (params.providerMessageId) {
    const existing = await prisma.salesMessage.findFirst({
      where: {
        organizationId: params.organizationId,
        channel: params.channel,
        providerMessageId: params.providerMessageId,
      },
    });
    if (existing) {
      return { message: toMessageDto(existing), duplicated: true };
    }
  }

  const conversation = await getOrCreateConversation({
    organizationId: params.organizationId,
    prospectId: params.prospectId,
    channel: params.channel,
    externalThreadId: params.externalThreadId || null,
  });

  let created;
  try {
    created = await prisma.salesMessage.create({
      data: {
        organizationId: params.organizationId,
        conversationId: conversation.id,
        direction: 'INBOUND',
        channel: params.channel,
        status: 'RECEIVED',
        fromAddress: params.from,
        toAddress: params.to || null,
        subject: params.subject || null,
        content: params.content,
        providerMessageId: params.providerMessageId,
        receivedAt: new Date(),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.salesMessage.findFirst({
        where: {
          organizationId: params.organizationId,
          channel: params.channel,
          providerMessageId: params.providerMessageId,
        },
      });
      if (existing) return { message: toMessageDto(existing), duplicated: true };
    }
    throw err;
  }

  await prisma.salesConversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: created.receivedAt },
  });
  await recordSalesActivity({
    organizationId: params.organizationId,
    prospectId: params.prospectId,
    type: 'MESSAGE_RECEIVED',
    payload: { messageId: created.id, channel: params.channel, providerMessageId: params.providerMessageId },
  });
  await transitionProspectStatus({
    organizationId: params.organizationId,
    prospectId: params.prospectId,
    next: 'REPLIED',
  });

  try {
    await enqueueSalesAgentRun({
      organizationId: params.organizationId,
      prospectId: params.prospectId,
      trigger: 'INBOUND_REPLY',
      inboundMessageId: created.id,
    });
  } catch (err) {
    logger.warn('[SalesInbound] agent_enqueue_failed', {
      messageId: created.id,
      prospectId: params.prospectId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { message: toMessageDto(created), duplicated: false };
}

async function findProspectByPhone(phone: string) {
  const digits = normalizePhoneDigits(phone);
  if (digits.length < 7) return null;
  const conversations = await prisma.salesConversation.findMany({
    where: { channel: 'WHATSAPP', externalThreadId: digits },
    include: { prospect: true },
    take: 5,
  });
  if (conversations[0]) {
    return {
      organizationId: conversations[0].organizationId,
      prospectId: conversations[0].prospectId,
    };
  }

  const contacts = await prisma.leadContact.findMany({
    where: {
      OR: [
        { phone: { contains: digits.slice(-8) } },
        { whatsapp: { contains: digits.slice(-8) } },
      ],
      salesProspects: { some: {} },
    },
    include: { salesProspects: { orderBy: { updatedAt: 'desc' }, take: 1 } },
    take: 20,
  });
  for (const contact of contacts) {
    const contactDigits = normalizePhoneDigits(contact.whatsapp || contact.phone || '');
    if (contactDigits === digits || contactDigits.endsWith(digits) || digits.endsWith(contactDigits)) {
      const prospect = contact.salesProspects[0];
      if (prospect) {
        return { organizationId: prospect.organizationId, prospectId: prospect.id };
      }
    }
  }
  return null;
}

export type WhatsAppInboundMessage = {
  id: string;
  from: string;
  text?: { body?: string };
  type?: string;
  timestamp?: string;
};

export function extractWhatsAppInboundMessages(body: unknown): WhatsAppInboundMessage[] {
  if (!body || typeof body !== 'object') return [];
  const root = body as { entry?: unknown[] };
  const out: WhatsAppInboundMessage[] = [];
  for (const entry of root.entry || []) {
    if (!entry || typeof entry !== 'object') continue;
    const changes = (entry as { changes?: unknown[] }).changes || [];
    for (const change of changes) {
      if (!change || typeof change !== 'object') continue;
      const value = (change as { value?: { messages?: WhatsAppInboundMessage[] } }).value;
      for (const msg of value?.messages || []) {
        if (msg?.id && msg.from) out.push(msg);
      }
    }
  }
  return out;
}

export async function ingestWhatsAppWebhook(body: unknown) {
  const messages = extractWhatsAppInboundMessages(body);
  const results = [];
  for (const msg of messages) {
    const text = msg.type === 'text' ? msg.text?.body || '' : `[${msg.type || 'unknown'}]`;
    const match = await findProspectByPhone(msg.from);
    if (!match) {
      results.push({ providerMessageId: msg.id, ignored: true, reason: 'NO_MATCHING_PROSPECT' });
      continue;
    }
    const ingested = await ingestInboundMessage({
      organizationId: match.organizationId,
      prospectId: match.prospectId,
      channel: 'WHATSAPP',
      from: normalizePhoneDigits(msg.from),
      content: text,
      providerMessageId: msg.id,
      externalThreadId: normalizePhoneDigits(msg.from),
    });
    results.push({ ...ingested, ignored: false });
  }
  return { results };
}

import { timingSafeEqualString } from '../system/provider-health.service';

export async function ingestInboundEmail(payload: InboundEmailPayload, secret: string | undefined) {
  if (!env.salesEmailWebhookSecret) {
    throw new AppError(503, 'Email inbound webhook 未配置', 'CHANNEL_NOT_CONFIGURED');
  }
  if (!secret || !timingSafeEqualString(secret, env.salesEmailWebhookSecret)) {
    throw new AppError(401, '无效的 webhook 密钥', 'WEBHOOK_UNAUTHORIZED');
  }
  const from = payload.from.trim().toLowerCase();
  const providerMessageId = payload.providerMessageId.trim();
  const content = payload.content.trim();
  if (!from || !providerMessageId || !content) {
    throw new AppError(400, 'from / providerMessageId / content 必填', 'BAD_REQUEST');
  }

  const contact = await prisma.leadContact.findFirst({
    where: {
      emailNormalized: from,
      salesProspects: { some: {} },
    },
    include: { salesProspects: { orderBy: { updatedAt: 'desc' }, take: 1 } },
  });
  const prospect = contact?.salesProspects[0];
  if (!prospect) {
    return { ignored: true, reason: 'NO_MATCHING_PROSPECT' as const };
  }
  return ingestInboundMessage({
    organizationId: prospect.organizationId,
    prospectId: prospect.id,
    channel: 'EMAIL',
    from,
    to: payload.to,
    subject: payload.subject,
    content,
    providerMessageId,
    externalThreadId: payload.threadId,
  });
}

export const inboundEmailService = {
  ingestInboundEmail,
};
