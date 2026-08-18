import { UnrecoverableError, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { createLeadQueueRedis } from '../queues/lead-queue.redis';
import {
  ensureSalesAgentFollowupScheduler,
  getSalesAgentQueueName,
  salesAgentJobDataSchema,
  SALES_AGENT_JOB_ATTEMPTS,
  type SalesAgentJobData,
  enqueueSalesAgentRun,
} from '../queues/sales-agent.queue';
import { runSalesAgent } from '../services/sales/sales-agent.service';
import { isAutoSendBlockedStatus } from '../services/sales/sales-agent.types';
import { recoverStaleSalesAgentRuns } from '../services/sales/sales-stale-recovery.service';

export function isUnrecoverableSalesAgentError(err: unknown): boolean {
  if (err instanceof UnrecoverableError) return true;
  if (err instanceof AppError) {
    return err.statusCode < 500 && err.statusCode !== 429;
  }
  return false;
}

export function isFinalSalesAgentFailure(
  attemptsMade: number,
  maxAttempts: number,
  err: unknown,
): boolean {
  if (isUnrecoverableSalesAgentError(err)) return true;
  return attemptsMade >= maxAttempts;
}

export async function processSalesAgentFollowupScan(): Promise<{ enqueued: number }> {
  const due = await prisma.salesProspect.findMany({
    where: {
      nextFollowUpAt: { lte: new Date() },
      status: { notIn: ['CLOSED', 'NOT_INTERESTED', 'HANDOFF'] },
    },
    take: 50,
    orderBy: { nextFollowUpAt: 'asc' },
  });
  let enqueued = 0;
  for (const p of due) {
    if (isAutoSendBlockedStatus(p.status)) continue;
    try {
      await enqueueSalesAgentRun({
        organizationId: p.organizationId,
        prospectId: p.id,
        trigger: 'SCHEDULED_FOLLOWUP',
      });
      enqueued += 1;
    } catch (err) {
      logger.warn('[SalesAgent] followup_enqueue_failed', {
        prospectId: p.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { enqueued };
}

export async function processSalesAgentJob(
  job: Pick<Job<SalesAgentJobData>, 'id' | 'data' | 'name'>,
): Promise<void> {
  const parsed = salesAgentJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new UnrecoverableError('Invalid sales agent job payload');
  }
  const data = parsed.data;
  if (data.kind === 'followup-scan' || job.name === 'followup-scan') {
    const result = await processSalesAgentFollowupScan();
    logger.info('[SalesAgent]', { jobId: job.id, phase: 'FOLLOWUP_SCAN', ...result });
    return;
  }

  if (!data.organizationId || !data.prospectId || !data.trigger) {
    throw new UnrecoverableError('Sales agent run job missing organizationId/prospectId/trigger');
  }

  logger.info('[SalesAgent]', {
    jobId: job.id,
    prospectId: data.prospectId,
    trigger: data.trigger,
    phase: 'RUNNING',
  });
  try {
    await runSalesAgent({
      organizationId: data.organizationId,
      prospectId: data.prospectId,
      trigger: data.trigger,
      inboundMessageId: data.inboundMessageId,
    });
    logger.info('[SalesAgent]', { jobId: job.id, prospectId: data.prospectId, phase: 'COMPLETED' });
  } catch (err) {
    if (isUnrecoverableSalesAgentError(err)) {
      throw new UnrecoverableError(err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

let workerRedis: Redis | null = null;

export function createSalesAgentWorker(): Worker<SalesAgentJobData> {
  workerRedis = createLeadQueueRedis();
  const worker = new Worker<SalesAgentJobData>(
    getSalesAgentQueueName(),
    async (job) => {
      await processSalesAgentJob(job);
    },
    {
      connection: workerRedis,
      concurrency: env.salesAgentWorkerConcurrency,
    },
  );

  worker.on('completed', (job) => {
    logger.info('sales_agent_job_completed', { jobId: job.id, kind: job.data.kind });
  });
  worker.on('failed', (job, err) => {
    logger.error('sales_agent_job_failed', {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      maxAttempts: job?.opts.attempts ?? SALES_AGENT_JOB_ATTEMPTS,
      error: err instanceof Error ? err.message : String(err),
    });
    const maxAttempts = job?.opts.attempts ?? SALES_AGENT_JOB_ATTEMPTS;
    const attemptsMade = job?.attemptsMade ?? 0;
    if (
      job?.data.kind === 'run' &&
      job.data.organizationId &&
      job.data.prospectId &&
      isFinalSalesAgentFailure(attemptsMade, maxAttempts, err)
    ) {
      void prisma.salesAgentRun
        .updateMany({
          where: {
            organizationId: job.data.organizationId,
            prospectId: job.data.prospectId,
            status: 'RUNNING',
            ...(job.data.inboundMessageId
              ? { triggerInboundMessageId: job.data.inboundMessageId }
              : {}),
          },
          data: {
            status: 'FAILED',
            errorCode: 'WORKER_FINAL_FAILURE',
            completedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }
  });

  void ensureSalesAgentFollowupScheduler().catch((err) => {
    logger.warn('sales_agent_followup_scheduler_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  void recoverStaleSalesAgentRuns().catch((err) => {
    logger.warn('sales_agent_stale_recovery_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return worker;
}

export async function closeSalesAgentWorker(worker: Worker<SalesAgentJobData>): Promise<void> {
  await worker.close();
  if (workerRedis) {
    await workerRedis.quit();
    workerRedis = null;
  }
}
