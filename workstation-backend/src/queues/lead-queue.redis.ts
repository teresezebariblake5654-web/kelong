/**
 * Isolated Redis clients for LobsterAI job queues.
 * Never reuse Firecrawl (or other provider) Redis instances.
 *
 * BullMQ v6 requires a real ioredis (or compatible) client instance.
 */
import Redis from 'ioredis';
import { env } from '../config/env';

export function createLeadQueueRedis(): Redis {
  return new Redis({
    host: env.leadQueueRedisHost,
    port: env.leadQueueRedisPort,
    db: env.leadQueueRedisDb,
    username: env.leadQueueRedisUsername || undefined,
    password: env.leadQueueRedisPassword || undefined,
    maxRetriesPerRequest: null,
  });
}
