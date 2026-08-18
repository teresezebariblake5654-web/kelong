import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { enqueueSalesOutboundJob } from '../../queues/sales-outbound.queue';
import { getSalesOutboundQueue } from '../../queues/sales-outbound.queue';
import { salesOutboundJobId } from '../../queues/sales-outbound.queue';

const STALE_QUEUED_MS = 15 * 60 * 1000;
const STALE_AGENT_RUNNING_MS = 20 * 60 * 1000;

/**
 * Re-enqueue outbound messages stuck in QUEUED when no active/waiting job exists.
 * Does not invent sends — only recovers orphaned queue state after worker/API restart.
 */
export async function recoverStaleSalesOutboundMessages(): Promise<{ requeued: number; failed: number }> {
  const cutoff = new Date(Date.now() - STALE_QUEUED_MS);
  const stale = await prisma.salesMessage.findMany({
    where: {
      direction: 'OUTBOUND',
      status: 'QUEUED',
      createdAt: { lt: cutoff },
    },
    take: 50,
    orderBy: { createdAt: 'asc' },
    include: { conversation: true },
  });

  let requeued = 0;
  let failed = 0;
  const queue = getSalesOutboundQueue();
  for (const msg of stale) {
    try {
      const job = await queue.getJob(salesOutboundJobId(msg.id));
      const state = job ? await job.getState() : null;
      if (state === 'active' || state === 'waiting' || state === 'delayed' || state === 'prioritized') {
        continue;
      }
      await enqueueSalesOutboundJob({
        messageId: msg.id,
        organizationId: msg.organizationId,
        prospectId: msg.conversation.prospectId,
        channel: msg.channel,
      });
      requeued += 1;
    } catch (err) {
      failed += 1;
      logger.warn('[SalesRecovery]', {
        messageId: msg.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (requeued || failed) {
    logger.info('[SalesRecovery]', { phase: 'outbound_queued', requeued, failed });
  }
  return { requeued, failed };
}

/**
 * Mark SalesAgentRun stuck in RUNNING as FAILED after worker crash.
 */
export async function recoverStaleSalesAgentRuns(): Promise<{ markedFailed: number }> {
  const cutoff = new Date(Date.now() - STALE_AGENT_RUNNING_MS);
  const result = await prisma.salesAgentRun.updateMany({
    where: {
      status: 'RUNNING',
      createdAt: { lt: cutoff },
    },
    data: {
      status: 'FAILED',
      errorCode: 'STALE_RUNNING_RECOVERED',
      completedAt: new Date(),
    },
  });
  if (result.count > 0) {
    logger.info('[SalesRecovery]', { phase: 'agent_running', markedFailed: result.count });
  }
  return { markedFailed: result.count };
}
