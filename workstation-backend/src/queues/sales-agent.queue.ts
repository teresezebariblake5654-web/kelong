/**
 * Sales agent job queue — isolated from lead-discovery and sales-outbound by name.
 */
import { Queue, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import Redis from 'ioredis';
import { env } from '../config/env';
import { createLeadQueueRedis } from './lead-queue.redis';

export const SALES_AGENT_JOB_NAME = 'run';
export const SALES_AGENT_FOLLOWUP_SCAN_JOB = 'followup-scan';
export const SALES_AGENT_JOB_ATTEMPTS = 2;
export const SALES_AGENT_JOB_BACKOFF_MS = 3_000;

export const salesAgentJobDataSchema = z
  .object({
    kind: z.enum(['run', 'followup-scan']).default('run'),
    messageId: z.string().min(1).optional(),
    organizationId: z.string().min(1).optional(),
    prospectId: z.string().min(1).optional(),
    trigger: z.enum(['INITIAL_OUTREACH', 'INBOUND_REPLY', 'SCHEDULED_FOLLOWUP', 'MANUAL']).optional(),
    inboundMessageId: z.string().min(1).optional(),
  })
  .strip();

export type SalesAgentJobData = z.infer<typeof salesAgentJobDataSchema>;

export type SalesAgentQueueLike = {
  add: (name: string, data: SalesAgentJobData, opts?: JobsOptions) => Promise<unknown>;
};

let queue: Queue<SalesAgentJobData> | null = null;
let producerRedis: Redis | null = null;

export function getSalesAgentQueueName(): string {
  return env.salesAgentQueueName;
}

function getProducerRedis(): Redis {
  if (!producerRedis) producerRedis = createLeadQueueRedis('producer');
  return producerRedis;
}

export function getSalesAgentQueue(): Queue<SalesAgentJobData> {
  if (!queue) {
    queue = new Queue<SalesAgentJobData>(getSalesAgentQueueName(), {
      connection: getProducerRedis(),
      defaultJobOptions: {
        attempts: SALES_AGENT_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: SALES_AGENT_JOB_BACKOFF_MS },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return queue;
}

export function salesAgentInboundJobId(inboundMessageId: string): string {
  return `sales-agent-inbound-${inboundMessageId}`;
}

export function salesAgentProspectJobId(prospectId: string, trigger: string): string {
  return `sales-agent-${trigger}-${prospectId}`;
}

export async function enqueueSalesAgentRun(
  data: {
    organizationId: string;
    prospectId: string;
    trigger: 'INITIAL_OUTREACH' | 'INBOUND_REPLY' | 'SCHEDULED_FOLLOWUP' | 'MANUAL';
    inboundMessageId?: string;
  },
  queueClient: SalesAgentQueueLike = getSalesAgentQueue(),
): Promise<{ jobId: string }> {
  const jobId = data.inboundMessageId
    ? salesAgentInboundJobId(data.inboundMessageId)
    : salesAgentProspectJobId(data.prospectId, data.trigger);
  await Promise.race([
    queueClient.add(
      SALES_AGENT_JOB_NAME,
      {
        kind: 'run',
        organizationId: data.organizationId,
        prospectId: data.prospectId,
        trigger: data.trigger,
        inboundMessageId: data.inboundMessageId,
      },
      {
        jobId,
        attempts: SALES_AGENT_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: SALES_AGENT_JOB_BACKOFF_MS },
      },
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('SALES_AGENT_QUEUE_UNAVAILABLE')), 4_000),
    ),
  ]);
  return { jobId };
}

export async function ensureSalesAgentFollowupScheduler(
  queueClient: Queue<SalesAgentJobData> = getSalesAgentQueue(),
): Promise<void> {
  await queueClient.upsertJobScheduler(
    'sales-agent-followup-scan',
    { every: env.salesAgentFollowupScanIntervalMs },
    {
      name: SALES_AGENT_FOLLOWUP_SCAN_JOB,
      data: { kind: 'followup-scan' },
      opts: {
        removeOnComplete: true,
        removeOnFail: { count: 50 },
      },
    },
  );
}

export async function closeSalesAgentQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (producerRedis) {
    await producerRedis.quit();
    producerRedis = null;
  }
}
