/**
 * Lead discovery job queue (producer).
 *
 * Job payload is intentionally small: identifiers + search params only.
 * Never put JWT, API keys, Firecrawl markdown, or LeadCompany arrays in Redis.
 */
import { Queue, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import Redis from 'ioredis';
import { env } from '../config/env';
import { createLeadQueueRedis } from './lead-queue.redis';

export const LEAD_DISCOVERY_JOB_NAME = 'discover';
export const LEAD_DISCOVERY_JOB_ATTEMPTS = 3;
export const LEAD_DISCOVERY_JOB_BACKOFF_MS = 2_000;

export const leadDiscoveryJobDataSchema = z
  .object({
    taskId: z.string().min(1),
    organizationId: z.string().min(1),
    query: z.string().min(1).max(500),
    targetCount: z.number().int().min(1).max(500).optional(),
    researchLimit: z.number().int().min(1).max(50).optional(),
    /** @deprecated prefer targetCount — kept for older queued jobs */
    maxCandidates: z.number().int().min(1).max(5).optional(),
  })
  .strip()
  .superRefine((data, ctx) => {
    if (data.targetCount == null && data.maxCandidates == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetCount'],
        message: 'Required',
      });
    }
  });

export type LeadDiscoveryJobData = z.infer<typeof leadDiscoveryJobDataSchema>;

export function resolveJobTargetCount(data: Pick<LeadDiscoveryJobData, 'targetCount' | 'maxCandidates'>): number {
  return data.targetCount ?? data.maxCandidates ?? 1;
}

export function resolveJobResearchLimit(
  data: Pick<LeadDiscoveryJobData, 'researchLimit'>,
): number {
  return data.researchLimit ?? env.leadAgentMaxResearchCompanies;
}

export type LeadDiscoveryQueueLike = {
  add: (
    name: string,
    data: LeadDiscoveryJobData,
    opts?: JobsOptions,
  ) => Promise<unknown>;
};

let queue: Queue<LeadDiscoveryJobData> | null = null;
let producerRedis: Redis | null = null;

export function leadDiscoveryJobId(taskId: string): string {
  return `lead-discovery-${taskId}`;
}

export function getLeadDiscoveryQueueName(): string {
  return env.leadDiscoveryQueueName;
}

function getProducerRedis(): Redis {
  if (!producerRedis) {
    producerRedis = createLeadQueueRedis('producer');
  }
  return producerRedis;
}

export function getLeadDiscoveryQueue(): Queue<LeadDiscoveryJobData> {
  if (!queue) {
    queue = new Queue<LeadDiscoveryJobData>(getLeadDiscoveryQueueName(), {
      connection: getProducerRedis(),
      defaultJobOptions: {
        attempts: LEAD_DISCOVERY_JOB_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: LEAD_DISCOVERY_JOB_BACKOFF_MS,
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return queue;
}

export function isDuplicateJobIdError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { message?: string; name?: string };
  const message = String(e.message ?? '');
  return (
    e.name === 'JobIdAlreadyExists' ||
    /job.*(already exists|id already exists)/i.test(message) ||
    /already exists/i.test(message)
  );
}

export async function enqueueLeadDiscoveryJob(
  data: LeadDiscoveryJobData,
  queueClient: LeadDiscoveryQueueLike = getLeadDiscoveryQueue(),
): Promise<{ jobId: string; duplicated: boolean }> {
  const parsed = leadDiscoveryJobDataSchema.parse(data);
  const jobId = leadDiscoveryJobId(parsed.taskId);
  const normalized: LeadDiscoveryJobData = {
    ...parsed,
    targetCount: resolveJobTargetCount(parsed),
    researchLimit: resolveJobResearchLimit(parsed),
    maxCandidates: undefined,
  };

  try {
    await Promise.race([
      queueClient.add(LEAD_DISCOVERY_JOB_NAME, normalized, {
        jobId,
        attempts: LEAD_DISCOVERY_JOB_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: LEAD_DISCOVERY_JOB_BACKOFF_MS,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('LEAD_QUEUE_UNAVAILABLE')), 4_000),
      ),
    ]);
    return { jobId, duplicated: false };
  } catch (err) {
    if (isDuplicateJobIdError(err)) {
      return { jobId, duplicated: true };
    }
    throw err;
  }
}

export async function closeLeadDiscoveryQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (producerRedis) {
    await producerRedis.quit();
    producerRedis = null;
  }
}

/**
 * Cancel helper: remove queued (waiting/delayed) discovery job if still inactive.
 * Does not interrupt an actively running worker job.
 */
export async function removeLeadDiscoveryJobIfInactive(taskId: string): Promise<boolean> {
  const q = getLeadDiscoveryQueue();
  const jobId = leadDiscoveryJobId(taskId);
  const job = await q.getJob(jobId);
  if (!job) return false;
  const state = await job.getState();
  if (state === 'waiting' || state === 'delayed' || state === 'prioritized' || state === 'waiting-children') {
    await job.remove();
    return true;
  }
  return false;
}
