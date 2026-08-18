/**
 * Sales outbound job queue. Isolated from lead-discovery by queue name.
 * Reuses the same LobsterAI Redis factory — never Firecrawl Redis.
 */
import { Queue, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import Redis from 'ioredis';
import { env } from '../config/env';
import { createLeadQueueRedis } from './lead-queue.redis';

export const SALES_OUTBOUND_JOB_NAME = 'send';
export const SALES_OUTBOUND_JOB_ATTEMPTS = 3;
export const SALES_OUTBOUND_JOB_BACKOFF_MS = 2_000;

export const salesOutboundJobDataSchema = z
  .object({
    messageId: z.string().min(1),
    organizationId: z.string().min(1),
    prospectId: z.string().min(1),
    channel: z.enum(['EMAIL', 'WHATSAPP']),
  })
  .strip();

export type SalesOutboundJobData = z.infer<typeof salesOutboundJobDataSchema>;

export type SalesOutboundQueueLike = {
  add: (name: string, data: SalesOutboundJobData, opts?: JobsOptions) => Promise<unknown>;
};

let queue: Queue<SalesOutboundJobData> | null = null;
let producerRedis: Redis | null = null;

export function salesOutboundJobId(messageId: string): string {
  return `sales-outbound-${messageId}`;
}

export function getSalesOutboundQueueName(): string {
  return env.salesOutboundQueueName;
}

function getProducerRedis(): Redis {
  if (!producerRedis) {
    producerRedis = createLeadQueueRedis('producer');
  }
  return producerRedis;
}

export function getSalesOutboundQueue(): Queue<SalesOutboundJobData> {
  if (!queue) {
    queue = new Queue<SalesOutboundJobData>(getSalesOutboundQueueName(), {
      connection: getProducerRedis(),
      defaultJobOptions: {
        attempts: SALES_OUTBOUND_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: SALES_OUTBOUND_JOB_BACKOFF_MS },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return queue;
}

export async function enqueueSalesOutboundJob(
  data: SalesOutboundJobData,
  queueClient: SalesOutboundQueueLike = getSalesOutboundQueue(),
): Promise<{ jobId: string }> {
  const parsed = salesOutboundJobDataSchema.parse(data);
  const jobId = salesOutboundJobId(parsed.messageId);
  await Promise.race([
    queueClient.add(SALES_OUTBOUND_JOB_NAME, parsed, {
      jobId,
      attempts: SALES_OUTBOUND_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: SALES_OUTBOUND_JOB_BACKOFF_MS },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('SALES_QUEUE_UNAVAILABLE')), 4_000),
    ),
  ]);
  return { jobId };
}

export async function closeSalesOutboundQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (producerRedis) {
    await producerRedis.quit();
    producerRedis = null;
  }
}
