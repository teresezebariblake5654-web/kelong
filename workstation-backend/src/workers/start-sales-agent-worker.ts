/**
 * Independent process for sales agent decisions / follow-up scan.
 *   npm run worker:sales-agent
 */
import { connectDatabase, disconnectDatabase } from '../config/database';
import { env } from '../config/env';
import { closeSalesAgentQueue } from '../queues/sales-agent.queue';
import { logger } from '../utils/logger';
import { closeSalesAgentWorker, createSalesAgentWorker } from './sales-agent.worker';

const SHUTDOWN_TIMEOUT_MS = 60_000;

async function main() {
  await connectDatabase();
  const worker = createSalesAgentWorker();
  logger.info('sales_agent_worker_listening', {
    queue: env.salesAgentQueueName,
    concurrency: env.salesAgentWorkerConcurrency,
    redisHost: env.leadQueueRedisHost,
    redisPort: env.leadQueueRedisPort,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forceTimer = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();
    try {
      await closeSalesAgentWorker(worker);
      await closeSalesAgentQueue();
      await disconnectDatabase();
      logger.info('sales_agent_worker_shutdown_complete', { signal });
      process.exit(exitCode);
    } catch (error) {
      logger.error('sales_agent_worker_shutdown_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT', 0);
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM', 0);
  });
}

main().catch(async (error) => {
  logger.error('sales_agent_worker_boot_failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  try {
    await disconnectDatabase();
  } catch {
    // ignore
  }
  process.exit(1);
});
