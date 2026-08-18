import { UnrecoverableError, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { createLeadQueueRedis } from '../queues/lead-queue.redis';
import {
  getSalesOutboundQueueName,
  salesOutboundJobDataSchema,
  SALES_OUTBOUND_JOB_ATTEMPTS,
  type SalesOutboundJobData,
} from '../queues/sales-outbound.queue';
import {
  deliverQueuedMessage,
  markOutboundMessageFailed,
} from '../services/sales/sales-outbound.service';
import { recoverStaleSalesOutboundMessages } from '../services/sales/sales-stale-recovery.service';

export function isUnrecoverableSalesSendError(err: unknown): boolean {
  if (err instanceof UnrecoverableError) return true;
  if (err instanceof AppError) {
    return err.code === 'CHANNEL_NOT_CONFIGURED' || (err.statusCode < 500 && err.statusCode !== 429);
  }
  return false;
}

export function isFinalSalesOutboundFailure(
  attemptsMade: number,
  maxAttempts: number,
  err: unknown,
): boolean {
  if (isUnrecoverableSalesSendError(err)) return true;
  return attemptsMade >= maxAttempts;
}

export async function processSalesOutboundJob(
  job: Pick<Job<SalesOutboundJobData>, 'id' | 'data' | 'attemptsMade' | 'opts'>,
): Promise<void> {
  const parsed = salesOutboundJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new UnrecoverableError('Invalid sales outbound job payload');
  }
  const { messageId, organizationId, channel } = parsed.data;
  logger.info('[SalesTask]', { jobId: job.id, messageId, organizationId, channel, phase: 'SENDING' });
  try {
    await deliverQueuedMessage({ messageId, organizationId, markFailedOnError: false });
    logger.info('[SalesTask]', { jobId: job.id, messageId, phase: 'SENT' });
  } catch (err) {
    const maxAttempts = job.opts?.attempts ?? SALES_OUTBOUND_JOB_ATTEMPTS;
    // During processing, attemptsMade is previous failures; +1 = current attempt.
    const currentAttempt = (job.attemptsMade ?? 0) + 1;
    if (isFinalSalesOutboundFailure(currentAttempt, maxAttempts, err) || isUnrecoverableSalesSendError(err)) {
      await markOutboundMessageFailed({ messageId, organizationId, error: err });
    }
    if (isUnrecoverableSalesSendError(err)) {
      throw new UnrecoverableError(err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

let workerRedis: Redis | null = null;

export function createSalesOutboundWorker(): Worker<SalesOutboundJobData> {
  workerRedis = createLeadQueueRedis();
  const worker = new Worker<SalesOutboundJobData>(
    getSalesOutboundQueueName(),
    async (job) => {
      await processSalesOutboundJob(job);
    },
    {
      connection: workerRedis,
      concurrency: env.salesOutboundWorkerConcurrency,
    },
  );

  worker.on('completed', (job) => {
    logger.info('sales_outbound_job_completed', { jobId: job.id, messageId: job.data.messageId });
  });
  worker.on('failed', (job, err) => {
    logger.error('sales_outbound_job_failed', {
      jobId: job?.id,
      messageId: job?.data.messageId,
      attemptsMade: job?.attemptsMade,
      maxAttempts: job?.opts.attempts ?? SALES_OUTBOUND_JOB_ATTEMPTS,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  void recoverStaleSalesOutboundMessages().catch((err) => {
    logger.warn('sales_outbound_stale_recovery_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return worker;
}

export async function closeSalesOutboundWorker(worker: Worker<SalesOutboundJobData>): Promise<void> {
  await worker.close();
  if (workerRedis) {
    await workerRedis.quit();
    workerRedis = null;
  }
}
