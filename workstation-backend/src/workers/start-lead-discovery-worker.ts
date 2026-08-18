/**
 * Independent process entry for the lead-discovery worker.
 *
 * Start separately from the API:
 *   npm run worker:leads
 */
import { connectDatabase, disconnectDatabase } from '../config/database';
import { env } from '../config/env';
import { initLlmRuntimeFromEnv } from '../providers/llm';
import { closeLeadDiscoveryQueue } from '../queues/lead-discovery.queue';
import { logger } from '../utils/logger';
import {
  closeLeadDiscoveryWorker,
  createLeadDiscoveryWorker,
} from './lead-discovery.worker';

const SHUTDOWN_TIMEOUT_MS = 60_000;

async function main() {
  initLlmRuntimeFromEnv();
  await connectDatabase();

  const worker = createLeadDiscoveryWorker();
  logger.info('lead_discovery_worker_listening', {
    queue: env.leadDiscoveryQueueName,
    concurrency: env.leadDiscoveryWorkerConcurrency,
    redisHost: env.leadQueueRedisHost,
    redisPort: env.leadQueueRedisPort,
    redisDb: env.leadQueueRedisDb,
  });

  let shuttingDown = false;

  const shutdown = async (signal: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.warn('lead_discovery_worker_shutdown_start', { signal });

    const forceTimer = setTimeout(() => {
      logger.error('lead_discovery_worker_shutdown_timeout', {
        timeoutMs: SHUTDOWN_TIMEOUT_MS,
      });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    try {
      await closeLeadDiscoveryWorker(worker);
      await closeLeadDiscoveryQueue();
      await disconnectDatabase();
      logger.info('lead_discovery_worker_shutdown_complete', { signal });
      process.exit(exitCode);
    } catch (error) {
      logger.error('lead_discovery_worker_shutdown_failed', {
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
  logger.error('lead_discovery_worker_boot_failed', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  try {
    await disconnectDatabase();
  } catch {
    // ignore
  }
  process.exit(1);
});
