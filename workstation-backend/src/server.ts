import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import { initLlmRuntimeFromEnv } from './providers/llm';
import { closeLeadDiscoveryQueue } from './queues/lead-discovery.queue';
import { logger } from './utils/logger';

const SHUTDOWN_TIMEOUT_MS = 15_000;

async function main() {
  // Validate LLM_BASE_URL (HTTPS) + LLM_API_KEY before accepting traffic.
  // Does not print secrets. Production throws if misconfigured.
  initLlmRuntimeFromEnv();

  await connectDatabase();

  const app = createApp();
  const server = app.listen(env.port, env.host, () => {
    logger.info('backend_listening', {
      host: env.host,
      port: env.port,
      nodeEnv: env.nodeEnv,
      rateLimitEnabled: env.rateLimitEnabled,
    });
  });

  let shuttingDown = false;

  const shutdown = async (signal: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.warn('backend_shutdown_start', { signal, exitCode });

    const forceTimer = setTimeout(() => {
      logger.error('backend_shutdown_timeout', { timeoutMs: SHUTDOWN_TIMEOUT_MS });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    // Stop accepting new connections immediately.
    server.close(async (closeError) => {
      if (closeError) {
        logger.error('backend_http_close_failed', {
          error: closeError instanceof Error ? closeError.message : String(closeError),
        });
      }
      try {
        await closeLeadDiscoveryQueue();
        await disconnectDatabase();
        logger.info('backend_database_disconnected');
        process.exit(exitCode);
      } catch (error) {
        logger.error('backend_database_disconnect_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      }
    });
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT', 0);
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM', 0);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled_rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
    void shutdown('unhandledRejection', 1);
  });

  process.on('uncaughtException', (error) => {
    logger.error('uncaught_exception', {
      error: error.message,
      stack: error.stack,
    });
    void shutdown('uncaughtException', 1);
  });
}

main().catch(async (error) => {
  logger.error('backend_boot_failed', {
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
