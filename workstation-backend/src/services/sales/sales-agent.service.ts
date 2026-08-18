/**
 * Sales Agent brain: structured LLM decisions + hard safety limits.
 * Sends only via existing queueOutboundMessage (Phase 2).
 */
import type { Prisma, SalesAgentRunTrigger, SalesChannel, SalesProspectStatus } from '@prisma/client';
import { Prisma as PrismaNS } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../config/database';
import {
  extractJsonObject,
  getActiveLlmModel,
  getOpenAICompatibleChatClient,
} from '../../providers/llm';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { recordSalesActivity } from './sales-activity.service';
import { requireActiveSalesAgentProfile } from './sales-agent-profile.service';
import {
  isAutoSendBlockedStatus,
  SALES_AGENT_LLM_ATTEMPTS,
  salesAgentDecisionSchema,
  type SalesAgentDecision,
  type SalesAgentLlmCall,
  type SalesReplyIntent,
} from './sales-agent.types';
import { queueOutboundMessage } from './sales-message.service';
import { requireProspect, transitionProspectStatus } from './sales-prospect.service';
import { assertOrgOutboundRateAllowed } from './sales-outbound-rate.service';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function defaultLlmCall(input: {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
}): Promise<unknown> {
  const client = getOpenAICompatibleChatClient();
  const result = await withTimeout(
    client.chat({
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      model: input.model,
      maxOutputTokens: input.maxOutputTokens,
      temperature: 0.2,
      jsonMode: true,
    }),
    input.timeoutMs,
    'sales-agent-llm',
  );
  return extractJsonObject(result.content);
}

export const SALES_AGENT_SYSTEM_PROMPT = `You are an AI B2B sales employee.

Return ONLY a JSON object (no markdown, no chain-of-thought):
{
  "action": "SEND" | "WAIT" | "FOLLOW_UP" | "HANDOFF" | "CLOSE",
  "channel": "EMAIL" | "WHATSAPP",
  "subject": string,
  "message": string,
  "nextFollowUpAt": ISO-8601 string,
  "prospectStatus": "NEW" | "CONTACTED" | "REPLIED" | "INTERESTED" | "NOT_INTERESTED" | "FOLLOW_UP" | "HANDOFF" | "CLOSED",
  "handoffReason": string,
  "replyIntent": "POSITIVE_INTEREST" | "REQUEST_INFO" | "REQUEST_QUOTE" | "REQUEST_MEETING" | "QUESTION" | "NOT_INTERESTED" | "UNSUBSCRIBE" | "OUT_OF_OFFICE" | "UNKNOWN",
  "summary": string
}

Rules:
- SEND only when you should message the prospect now. Include channel + message (+ subject for EMAIL).
- FOLLOW_UP: schedule nextFollowUpAt in the future; do not send now unless also using SEND (prefer FOLLOW_UP alone).
- HANDOFF for REQUEST_QUOTE, REQUEST_MEETING, complex pricing, contracts, or unsafe answers. Set handoffReason + prospectStatus HANDOFF.
- CLOSE / NOT_INTERESTED for unsubscribe or clear rejection. Never try to persuade after unsubscribe.
- Keep message concise, in the profile language/tone. Do not invent exact prices.
- summary: one short sentence. Never include chain-of-thought.`;

function detectIntentFromText(text: string): SalesReplyIntent | undefined {
  const t = text.toLowerCase();
  if (/\b(unsubscribe|stop contacting|remove me|do not contact|don't contact)\b/.test(t)) {
    return 'UNSUBSCRIBE';
  }
  if (/\b(not interested|no thanks|no thank you|please stop)\b/.test(t)) {
    return 'NOT_INTERESTED';
  }
  if (/\b(out of office|ooo|automatic reply|auto-reply)\b/.test(t)) {
    return 'OUT_OF_OFFICE';
  }
  if (/\b(quote|pricing|price list|proforma|quotation)\b/.test(t)) {
    return 'REQUEST_QUOTE';
  }
  if (/\b(meeting|call|schedule|demo|zoom|teams)\b/.test(t)) {
    return 'REQUEST_MEETING';
  }
  if (/\b(interested|sounds good|please send|tell me more)\b/.test(t)) {
    return 'POSITIVE_INTEREST';
  }
  return undefined;
}

export function buildDeterministicSalesDecision(input: {
  trigger: SalesAgentRunTrigger;
  preferredChannel: SalesChannel;
  inboundText?: string;
  profileLanguage: string;
  companyName?: string | null;
}): SalesAgentDecision {
  const channel = input.preferredChannel;
  const intent = input.inboundText ? detectIntentFromText(input.inboundText) : undefined;

  if (intent === 'UNSUBSCRIBE') {
    return salesAgentDecisionSchema.parse({
      action: 'CLOSE',
      prospectStatus: 'CLOSED',
      replyIntent: 'UNSUBSCRIBE',
      summary: 'Prospect requested stop contact',
    });
  }
  if (intent === 'NOT_INTERESTED') {
    return salesAgentDecisionSchema.parse({
      action: 'CLOSE',
      prospectStatus: 'NOT_INTERESTED',
      replyIntent: 'NOT_INTERESTED',
      summary: 'Prospect not interested',
    });
  }
  if (intent === 'REQUEST_QUOTE' || intent === 'REQUEST_MEETING') {
    return salesAgentDecisionSchema.parse({
      action: 'HANDOFF',
      prospectStatus: 'HANDOFF',
      replyIntent: intent,
      handoffReason: intent === 'REQUEST_QUOTE' ? 'Customer requested quote/pricing' : 'Customer requested a meeting',
      summary: `Handoff due to ${intent}`,
    });
  }
  if (intent === 'OUT_OF_OFFICE') {
    const next = new Date(Date.now() + env.salesAgentMinFollowupIntervalHours * 3600_000).toISOString();
    return salesAgentDecisionSchema.parse({
      action: 'FOLLOW_UP',
      prospectStatus: 'FOLLOW_UP',
      replyIntent: 'OUT_OF_OFFICE',
      nextFollowUpAt: next,
      summary: 'Out of office — schedule follow-up',
    });
  }

  if (input.trigger === 'INITIAL_OUTREACH' || input.trigger === 'MANUAL' || input.trigger === 'SCHEDULED_FOLLOWUP') {
    const name = input.companyName || 'your team';
    const message =
      input.profileLanguage.startsWith('zh')
        ? `您好，我们注意到 ${name} 可能适合我们的产品。如方便，想简单了解贵司采购需求，方便进一步沟通吗？`
        : `Hello — we noticed ${name} may be a fit for our offering. Would you be open to a brief conversation about your current sourcing needs?`;
    return salesAgentDecisionSchema.parse({
      action: 'SEND',
      channel,
      subject: channel === 'EMAIL' ? `Quick intro regarding ${name}` : undefined,
      message,
      prospectStatus: 'CONTACTED',
      summary: 'Deterministic first/follow-up outreach',
    });
  }

  if (intent === 'POSITIVE_INTEREST' || intent === 'REQUEST_INFO' || intent === 'QUESTION') {
    return salesAgentDecisionSchema.parse({
      action: 'HANDOFF',
      prospectStatus: 'HANDOFF',
      replyIntent: intent ?? 'POSITIVE_INTEREST',
      handoffReason: 'Positive interest — human should continue',
      summary: 'Positive inbound — handoff',
    });
  }

  return salesAgentDecisionSchema.parse({
    action: 'WAIT',
    prospectStatus: 'REPLIED',
    replyIntent: intent ?? 'UNKNOWN',
    summary: 'No clear next action',
  });
}

function stripForbiddenKeys(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const banned = new Set([
    'reasoning',
    'chainOfThought',
    'chain_of_thought',
    'cot',
    'thoughts',
    'analysis',
    'scratchpad',
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (banned.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export async function countOutboundMessages(params: {
  organizationId: string;
  prospectId: string;
}): Promise<number> {
  const conversations = await prisma.salesConversation.findMany({
    where: { organizationId: params.organizationId, prospectId: params.prospectId },
    select: { id: true },
  });
  if (conversations.length === 0) return 0;
  return prisma.salesMessage.count({
    where: {
      organizationId: params.organizationId,
      conversationId: { in: conversations.map((c) => c.id) },
      direction: 'OUTBOUND',
      status: { in: ['QUEUED', 'SENT', 'DELIVERED'] },
    },
  });
}

export async function loadSalesAgentContext(params: {
  organizationId: string;
  prospectId: string;
  messageLimit?: number;
}) {
  const limit = Math.min(
    Math.max(params.messageLimit ?? env.salesAgentContextMessageLimit, 1),
    env.salesAgentContextMessageLimit,
  );
  const prospect = await requireProspect(params);
  const [company, contact, score, conversations, profile] = await Promise.all([
    prisma.leadCompany.findFirst({
      where: { id: prospect.leadCompanyId, organizationId: params.organizationId },
    }),
    prospect.leadContactId
      ? prisma.leadContact.findFirst({
          where: { id: prospect.leadContactId, organizationId: params.organizationId },
        })
      : Promise.resolve(null),
    prisma.leadScore.findFirst({
      where: { companyId: prospect.leadCompanyId, organizationId: params.organizationId },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.salesConversation.findMany({
      where: { organizationId: params.organizationId, prospectId: prospect.id },
      select: { id: true },
    }),
    requireActiveSalesAgentProfile(params.organizationId),
  ]);

  const messages = await prisma.salesMessage.findMany({
    where: {
      organizationId: params.organizationId,
      conversationId: { in: conversations.map((c) => c.id) },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  messages.reverse();

  return {
    prospect,
    company,
    contact,
    score,
    profile,
    messages,
    messageLimit: limit,
  };
}

export type RunSalesAgentInput = {
  organizationId: string;
  prospectId: string;
  trigger: SalesAgentRunTrigger;
  inboundMessageId?: string;
  llmCall?: SalesAgentLlmCall;
  /** When false, skip queue enqueue (tests that only need decision). Default true. */
  executeActions?: boolean;
};

export type RunSalesAgentResult = {
  runId: string;
  status: string;
  decision: SalesAgentDecision | null;
  skippedReason?: string;
  outboundMessageId?: string;
  duplicated?: boolean;
};

async function markRun(
  runId: string,
  data: {
    status: 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'RUNNING';
    decision?: SalesAgentDecision | null;
    errorCode?: string | null;
    model?: string | null;
  },
) {
  return prisma.salesAgentRun.update({
    where: { id: runId },
    data: {
      status: data.status,
      decision: data.decision === undefined ? undefined : (data.decision as Prisma.InputJsonValue),
      errorCode: data.errorCode ?? undefined,
      model: data.model ?? undefined,
      completedAt: data.status === 'RUNNING' ? undefined : new Date(),
    },
  });
}

export async function runSalesAgent(input: RunSalesAgentInput): Promise<RunSalesAgentResult> {
  const executeActions = input.executeActions !== false;

  if (input.trigger === 'INBOUND_REPLY' && input.inboundMessageId) {
    const existing = await prisma.salesAgentRun.findFirst({
      where: {
        organizationId: input.organizationId,
        triggerInboundMessageId: input.inboundMessageId,
      },
    });
    if (existing) {
      return {
        runId: existing.id,
        status: existing.status,
        decision: (existing.decision as SalesAgentDecision | null) ?? null,
        duplicated: true,
      };
    }
  }

  const ctx = await loadSalesAgentContext({
    organizationId: input.organizationId,
    prospectId: input.prospectId,
  });

  let run;
  try {
    run = await prisma.salesAgentRun.create({
      data: {
        organizationId: input.organizationId,
        prospectId: input.prospectId,
        profileId: ctx.profile.id,
        trigger: input.trigger,
        triggerInboundMessageId: input.inboundMessageId || null,
        status: 'RUNNING',
        inputRefs: {
          leadCompanyId: ctx.company?.id ?? null,
          leadContactId: ctx.contact?.id ?? null,
          leadScoreId: ctx.score?.id ?? null,
          profileId: ctx.profile.id,
          messageIds: ctx.messages.map((m) => m.id),
          messageCount: ctx.messages.length,
          messageLimit: ctx.messageLimit,
        },
        model: getActiveLlmModel(),
      },
    });
  } catch (err) {
    if (err instanceof PrismaNS.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.salesAgentRun.findFirst({
        where: {
          organizationId: input.organizationId,
          triggerInboundMessageId: input.inboundMessageId,
        },
      });
      if (existing) {
        return {
          runId: existing.id,
          status: existing.status,
          decision: existing.decision as SalesAgentDecision | null,
          duplicated: true,
        };
      }
    }
    throw err;
  }

  if (isAutoSendBlockedStatus(ctx.prospect.status) && input.trigger !== 'MANUAL') {
    const decision = salesAgentDecisionSchema.parse({
      action: 'WAIT',
      prospectStatus: ctx.prospect.status,
      summary: `Auto-run skipped: prospect status ${ctx.prospect.status}`,
    });
    await markRun(run.id, { status: 'SKIPPED', decision, errorCode: 'AUTO_SEND_BLOCKED' });
    return { runId: run.id, status: 'SKIPPED', decision, skippedReason: 'AUTO_SEND_BLOCKED' };
  }

  const outboundCount = await countOutboundMessages({
    organizationId: input.organizationId,
    prospectId: input.prospectId,
  });
  const minIntervalMs = env.salesAgentMinFollowupIntervalHours * 3600_000;
  const lastOutboundAt = ctx.prospect.lastOutboundAt;
  const tooSoon =
    Boolean(lastOutboundAt) &&
    Date.now() - lastOutboundAt!.getTime() < minIntervalMs &&
    (input.trigger === 'SCHEDULED_FOLLOWUP' || input.trigger === 'INITIAL_OUTREACH');

  const inboundText =
    input.inboundMessageId != null
      ? ctx.messages.find((m) => m.id === input.inboundMessageId)?.content
      : ctx.messages.filter((m) => m.direction === 'INBOUND').slice(-1)[0]?.content;

  const forcedIntent = inboundText ? detectIntentFromText(inboundText) : undefined;
  let decision: SalesAgentDecision;
  let source: 'llm' | 'fallback' | 'forced' = 'fallback';

  if (forcedIntent === 'UNSUBSCRIBE' || forcedIntent === 'NOT_INTERESTED') {
    decision = buildDeterministicSalesDecision({
      trigger: input.trigger,
      preferredChannel: ctx.prospect.preferredChannel,
      inboundText,
      profileLanguage: ctx.profile.language,
      companyName: ctx.company?.name,
    });
    source = 'forced';
  } else if (forcedIntent === 'REQUEST_QUOTE' || forcedIntent === 'REQUEST_MEETING') {
    decision = buildDeterministicSalesDecision({
      trigger: input.trigger,
      preferredChannel: ctx.prospect.preferredChannel,
      inboundText,
      profileLanguage: ctx.profile.language,
      companyName: ctx.company?.name,
    });
    source = 'forced';
  } else {
    const fallback = buildDeterministicSalesDecision({
      trigger: input.trigger,
      preferredChannel: ctx.prospect.preferredChannel,
      inboundText,
      profileLanguage: ctx.profile.language,
      companyName: ctx.company?.name,
    });
    const llmCall = input.llmCall ?? defaultLlmCall;
    const userPrompt = JSON.stringify({
      trigger: input.trigger,
      profile: {
        name: ctx.profile.name,
        role: ctx.profile.role,
        companyDescription: ctx.profile.companyDescription,
        productDescription: ctx.profile.productDescription,
        targetCustomerDescription: ctx.profile.targetCustomerDescription,
        tone: ctx.profile.tone,
        language: ctx.profile.language,
        salesInstructions: ctx.profile.salesInstructions,
        handoffInstructions: ctx.profile.handoffInstructions,
      },
      prospect: {
        id: ctx.prospect.id,
        status: ctx.prospect.status,
        preferredChannel: ctx.prospect.preferredChannel,
        nextFollowUpAt: ctx.prospect.nextFollowUpAt?.toISOString() ?? null,
      },
      company: ctx.company
        ? {
            id: ctx.company.id,
            name: ctx.company.name,
            domain: ctx.company.domain,
            country: ctx.company.country,
            industry: ctx.company.industry,
            description: ctx.company.description,
          }
        : null,
      contact: ctx.contact
        ? {
            id: ctx.contact.id,
            fullName: ctx.contact.fullName,
            jobTitle: ctx.contact.jobTitle,
            email: ctx.contact.emailNormalized || ctx.contact.email,
            phone: ctx.contact.phone,
          }
        : null,
      score: ctx.score
        ? {
            overallScore: ctx.score.overallScore,
            grade: ctx.score.grade,
            contactabilityScore: ctx.score.contactabilityScore,
          }
        : null,
      recentMessages: ctx.messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        channel: m.channel,
        status: m.status,
        subject: m.subject,
        content: m.content.slice(0, 2000),
        createdAt: m.createdAt.toISOString(),
      })),
      safety: {
        outboundCount,
        maxOutbound: env.salesAgentMaxOutboundPerProspect,
        minFollowupIntervalHours: env.salesAgentMinFollowupIntervalHours,
      },
    });

    let lastError: string | undefined;
    let llmDecision: SalesAgentDecision | null = null;
    for (let attempt = 1; attempt <= SALES_AGENT_LLM_ATTEMPTS; attempt += 1) {
      try {
        const raw = await llmCall({
          systemPrompt: SALES_AGENT_SYSTEM_PROMPT,
          userPrompt:
            attempt === 1
              ? userPrompt
              : `${userPrompt}\n\nPrevious output failed schema validation (${lastError}). Return ONLY valid JSON matching the schema.`,
          model: getActiveLlmModel(),
          maxOutputTokens: Math.min(env.aiMaxOutputTokens || 1200, 1200),
          timeoutMs: env.salesAgentLlmTimeoutMs,
        });
        const cleaned = stripForbiddenKeys(raw);
        const parsed = salesAgentDecisionSchema.safeParse(cleaned);
        if (!parsed.success) {
          lastError = parsed.error.issues
            .slice(0, 3)
            .map((i) => i.message)
            .join('; ');
          logger.warn('[SalesAgent] schema_retry', { attempt, error: lastError });
          continue;
        }
        llmDecision = parsed.data;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        logger.warn('[SalesAgent] llm_retry', { attempt, error: lastError });
      }
    }
    decision = llmDecision ?? fallback;
    source = llmDecision ? 'llm' : 'fallback';
  }

  // Hard safety overrides (never leave to LLM)
  if (decision.replyIntent === 'UNSUBSCRIBE') {
    decision = {
      ...decision,
      action: 'CLOSE',
      prospectStatus: 'CLOSED',
    };
  } else if (decision.replyIntent === 'NOT_INTERESTED') {
    decision = {
      ...decision,
      action: 'CLOSE',
      prospectStatus: 'NOT_INTERESTED',
    };
  } else if (decision.replyIntent === 'REQUEST_QUOTE' || decision.replyIntent === 'REQUEST_MEETING') {
    decision = {
      ...decision,
      action: 'HANDOFF',
      prospectStatus: 'HANDOFF',
      handoffReason:
        decision.handoffReason ||
        (decision.replyIntent === 'REQUEST_QUOTE'
          ? 'Customer requested quote/pricing'
          : 'Customer requested a meeting'),
    };
  }

  if (decision.action === 'SEND') {
    if (isAutoSendBlockedStatus(ctx.prospect.status)) {
      decision = {
        ...decision,
        action: 'WAIT',
        summary: `Blocked send: status ${ctx.prospect.status}`,
      };
    } else if (outboundCount >= env.salesAgentMaxOutboundPerProspect) {
      decision = {
        ...decision,
        action: 'WAIT',
        prospectStatus: ctx.prospect.status === 'NEW' ? 'FOLLOW_UP' : ctx.prospect.status,
        summary: 'Blocked send: max outbound per prospect reached',
      };
    } else if (tooSoon && input.trigger === 'SCHEDULED_FOLLOWUP') {
      decision = {
        ...decision,
        action: 'WAIT',
        summary: 'Blocked send: min follow-up interval',
      };
    } else {
      try {
        await assertOrgOutboundRateAllowed(input.organizationId);
      } catch (err) {
        if (err instanceof AppError && err.code === 'ORG_OUTBOUND_RATE_LIMITED') {
          decision = {
            ...decision,
            action: 'WAIT',
            summary: 'Blocked send: org hourly outbound limit',
          };
        } else {
          throw err;
        }
      }
    }
  }

  let outboundMessageId: string | undefined;
  try {
    if (executeActions) {
      if (decision.action === 'SEND' && decision.message && decision.channel) {
        const queued = await queueOutboundMessage({
          organizationId: input.organizationId,
          prospectId: input.prospectId,
          channel: decision.channel,
          subject: decision.subject,
          content: decision.message,
          idempotencyKey: `agent-run-${run.id}`,
        });
        outboundMessageId = queued.message.id;
        await prisma.salesProspect.update({
          where: { id: input.prospectId },
          data: { lastOutboundAt: new Date(), nextFollowUpAt: null },
        });
      }

      if (decision.action === 'FOLLOW_UP' && decision.nextFollowUpAt) {
        const at = new Date(decision.nextFollowUpAt);
        if (!Number.isNaN(at.getTime()) && at.getTime() > Date.now()) {
          await prisma.salesProspect.update({
            where: { id: input.prospectId },
            data: { nextFollowUpAt: at },
          });
        }
      }

      if (decision.action === 'HANDOFF' || decision.prospectStatus === 'HANDOFF') {
        await prisma.salesProspect.update({
          where: { id: input.prospectId },
          data: {
            handoff: {
              reason: decision.handoffReason || 'Handoff',
              summary: decision.summary || null,
              requestedAt: new Date().toISOString(),
            },
            nextFollowUpAt: null,
          },
        });
        await recordSalesActivity({
          organizationId: input.organizationId,
          prospectId: input.prospectId,
          type: 'HANDOFF',
          payload: {
            reason: decision.handoffReason,
            summary: decision.summary,
            runId: run.id,
          },
        });
      }

      if (decision.action === 'CLOSE' || decision.prospectStatus === 'CLOSED' || decision.prospectStatus === 'NOT_INTERESTED') {
        await prisma.salesProspect.update({
          where: { id: input.prospectId },
          data: { nextFollowUpAt: null },
        });
      }

      const nextStatus = decision.prospectStatus as SalesProspectStatus;
      if (nextStatus !== ctx.prospect.status) {
        await transitionProspectStatus({
          organizationId: input.organizationId,
          prospectId: input.prospectId,
          next: nextStatus,
        });
      }
    }

    await recordSalesActivity({
      organizationId: input.organizationId,
      prospectId: input.prospectId,
      type: 'AGENT_DECISION',
      payload: {
        runId: run.id,
        action: decision.action,
        source,
        replyIntent: decision.replyIntent ?? null,
        // final decision only — no CoT
        decision: {
          action: decision.action,
          channel: decision.channel,
          prospectStatus: decision.prospectStatus,
          replyIntent: decision.replyIntent,
          summary: decision.summary,
        },
      },
    });

    await markRun(run.id, {
      status: 'COMPLETED',
      decision,
      model: getActiveLlmModel(),
    });

    return {
      runId: run.id,
      status: 'COMPLETED',
      decision,
      outboundMessageId,
    };
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'SALES_AGENT_EXECUTE_FAILED';
    await markRun(run.id, {
      status: 'FAILED',
      decision,
      errorCode: code,
    });
    throw err;
  }
}

export const salesAgentService = {
  runSalesAgent,
  loadSalesAgentContext,
  buildDeterministicSalesDecision,
  countOutboundMessages,
  SALES_AGENT_SYSTEM_PROMPT,
};
