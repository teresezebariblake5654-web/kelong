/**
 * Lead discovery BullMQ worker (consumer).
 * Must run as a separate process from Express — never inside a request handler.
 */
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import {
  getLeadDiscoveryQueueName,
  leadDiscoveryJobDataSchema,
  LEAD_DISCOVERY_JOB_ATTEMPTS,
  type LeadDiscoveryJobData,
} from '../queues/lead-discovery.queue';
import { createLeadQueueRedis } from '../queues/lead-queue.redis';
import { executeLeadDiscoveryTask } from '../services/leads/lead-discovery-run.service';
import { leadPersistenceService } from '../services/leads/lead-persistence.service';
import { isLeadTaskCancelledError } from '../services/leads/lead-task-cancelled.error';

export function isUnrecoverableLeadDiscoveryError(err: unknown): boolean {
  if (err instanceof UnrecoverableError) return true;
  if (isLeadTaskCancelledError(err)) return true;
  if (err instanceof AppError) {
    return err.statusCode < 500 && err.statusCode !== 408 && err.statusCode !== 429;
  }
  return false;
}

export function isFinalLeadDiscoveryFailure(
  attemptsMade: number,
  maxAttempts: number,
  err: unknown,
): boolean {
  if (isUnrecoverableLeadDiscoveryError(err)) return true;
  return attemptsMade >= maxAttempts;
}

export async function handleLeadDiscoveryJobFailed(
  job: Pick<Job<LeadDiscoveryJobData>, 'id' | 'data' | 'attemptsMade' | 'opts'> | undefined,
  err: unknown,
): Promise<boolean> {
  if (!job) return false;

  // Cancelled tasks are terminal — never route through failSearchTask / FAILED.
  if (isLeadTaskCancelledError(err)) {
    logger.info('lead_discovery_job_cancelled', {
      jobId: job.id,
      taskId: job.data.taskId,
      attemptsMade: job.attemptsMade,
    });
    return true;
  }

  const maxAttempts = job.opts.attempts ?? LEAD_DISCOVERY_JOB_ATTEMPTS;
  const final = isFinalLeadDiscoveryFailure(job.attemptsMade, maxAttempts, err);
  if (!final) {
    logger.warn('lead_discovery_job_attempt_failed', {
      jobId: job.id,
      taskId: job.data.taskId,
      attemptsMade: job.attemptsMade,
      maxAttempts,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }

  await leadPersistenceService.failSearchTask({
    taskId: job.data.taskId,
    error: err,
  });
  logger.error('lead_discovery_job_failed_final', {
    jobId: job.id,
    taskId: job.data.taskId,
    attemptsMade: job.attemptsMade,
    maxAttempts,
    error: err instanceof Error ? err.message : String(err),
  });
  return true;
}

export async function processLeadDiscoveryJob(
  job: Pick<Job<LeadDiscoveryJobData>, 'id' | 'data'>,
): Promise<void> {
  const parsed = leadDiscoveryJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new UnrecoverableError('Invalid lead discovery job payload');
  }

  const { taskId, organizationId, query, targetCount, researchLimit, maxCandidates } = parsed.data;
  logger.info('lead_discovery_job_start', {
    jobId: job.id,
    taskId,
    organizationId,
    targetCount: targetCount ?? maxCandidates,
  });

  try {
    await executeLeadDiscoveryTask({
      taskId,
      organizationId,
      query,
      targetCount,
      researchLimit,
      maxCandidates,
    });
  } catch (err) {
    if (isUnrecoverableLeadDiscoveryError(err)) {
      const message = err instanceof Error ? err.message : String(err);
      throw new UnrecoverableError(message);
    }
    throw err;
  }
}

let workerRedis: Redis | null = null;
let lastWorkerErrorLogAt = 0;

export function createLeadDiscoveryWorker(): Worker<LeadDiscoveryJobData> {
  workerRedis = createLeadQueueRedis();
  const worker = new Worker<LeadDiscoveryJobData>(
    getLeadDiscoveryQueueName(),
    async (job) => {
      await processLeadDiscoveryJob(job);
    },
    {
      connection: workerRedis,
      concurrency: env.leadDiscoveryWorkerConcurrency,
    },
  );

  worker.on('completed', (job) => {
    logger.info('lead_discovery_job_completed', {
      jobId: job.id,
      taskId: job.data.taskId,
    });
  });

  worker.on('failed', (job, err) => {
    void handleLeadDiscoveryJobFailed(job, err);
  });

  worker.on('error', (err) => {
    const now = Date.now();
    if (now - lastWorkerErrorLogAt < 5_000) return;
    lastWorkerErrorLogAt = now;
    logger.error('lead_discovery_worker_error', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return worker;
}

export async function closeLeadDiscoveryWorker(
  worker: Worker<LeadDiscoveryJobData>,
): Promise<void> {
  await worker.close();
  if (workerRedis) {
    await workerRedis.quit();
    workerRedis = null;
  }
}
