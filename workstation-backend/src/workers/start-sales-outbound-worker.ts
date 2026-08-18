/**
 * Independent process for sales outbound sends.
 *   npm run worker:sales
 */
import { connectDatabase, disconnectDatabase } from '../config/database';
import { env } from '../config/env';
import { closeSalesOutboundQueue } from '../queues/sales-outbound.queue';
import { logger } from '../utils/logger';
import {
  closeSalesOutboundWorker,
  createSalesOutboundWorker,
} from './sales-outbound.worker';

const SHUTDOWN_TIMEOUT_MS = 60_000;

async function main() {
  await connectDatabase();
  const worker = createSalesOutboundWorker();
  logger.info('sales_outbound_worker_listening', {
    queue: env.salesOutboundQueueName,
    concurrency: env.salesOutboundWorkerConcurrency,
    redisHost: env.leadQueueRedisHost,
    redisPort: env.leadQueueRedisPort,
    redisDb: env.leadQueueRedisDb,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forceTimer = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();
    try {
      await closeSalesOutboundWorker(worker);
      await closeSalesOutboundQueue();
      await disconnectDatabase();
      logger.info('sales_outbound_worker_shutdown_complete', { signal });
      process.exit(exitCode);
    } catch (error) {
      logger.error('sales_outbound_worker_shutdown_failed', {
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
  logger.error('sales_outbound_worker_boot_failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  try {
    await disconnectDatabase();
  } catch {
    // ignore
  }
  process.exit(1);
});
