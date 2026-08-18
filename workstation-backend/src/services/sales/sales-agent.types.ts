import { z } from 'zod';

export const SALES_AGENT_LLM_ATTEMPTS = 2;
export const SALES_AGENT_CONTEXT_MESSAGE_LIMIT_DEFAULT = 20;

export const salesReplyIntentSchema = z.enum([
  'POSITIVE_INTEREST',
  'REQUEST_INFO',
  'REQUEST_QUOTE',
  'REQUEST_MEETING',
  'QUESTION',
  'NOT_INTERESTED',
  'UNSUBSCRIBE',
  'OUT_OF_OFFICE',
  'UNKNOWN',
]);

export type SalesReplyIntent = z.infer<typeof salesReplyIntentSchema>;

export const salesAgentDecisionSchema = z
  .object({
    action: z.enum(['SEND', 'WAIT', 'FOLLOW_UP', 'HANDOFF', 'CLOSE']),
    channel: z.enum(['EMAIL', 'WHATSAPP']).optional(),
    subject: z.string().trim().max(200).optional(),
    message: z.string().trim().max(8000).optional(),
    nextFollowUpAt: z.string().min(1).optional(),
    prospectStatus: z.enum([
      'NEW',
      'CONTACTED',
      'REPLIED',
      'INTERESTED',
      'NOT_INTERESTED',
      'FOLLOW_UP',
      'HANDOFF',
      'CLOSED',
    ]),
    handoffReason: z.string().trim().max(500).optional(),
    replyIntent: salesReplyIntentSchema.optional(),
    summary: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.action === 'SEND') {
      if (!data.message?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['message'], message: 'SEND requires message' });
      }
      if (!data.channel) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['channel'], message: 'SEND requires channel' });
      }
    }
    if (data.action === 'HANDOFF' && !data.handoffReason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['handoffReason'],
        message: 'HANDOFF requires handoffReason',
      });
    }
    if (data.action === 'FOLLOW_UP' && !data.nextFollowUpAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nextFollowUpAt'],
        message: 'FOLLOW_UP requires nextFollowUpAt',
      });
    }
  });

export type SalesAgentDecision = z.infer<typeof salesAgentDecisionSchema>;

export type SalesAgentLlmCall = (input: {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
}) => Promise<unknown>;

export const TERMINAL_AUTO_SEND_STATUSES = new Set([
  'NOT_INTERESTED',
  'CLOSED',
  'HANDOFF',
] as const);

export function isAutoSendBlockedStatus(status: string): boolean {
  return TERMINAL_AUTO_SEND_STATUSES.has(status as 'NOT_INTERESTED' | 'CLOSED' | 'HANDOFF');
}
