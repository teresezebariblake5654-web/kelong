/**
 * Isolated Redis clients for LobsterAI job queues.
 * Never reuse Firecrawl (or other provider) Redis instances.
 *
 * BullMQ v6 requires a real ioredis (or compatible) client instance.
 */
import Redis from 'ioredis';
import { env } from '../config/env';

export function createLeadQueueRedis(kind: 'worker' | 'producer' = 'worker'): Redis {
  const producer = kind === 'producer';
  const redis = new Redis({
    host: env.leadQueueRedisHost,
    port: env.leadQueueRedisPort,
    db: env.leadQueueRedisDb,
    username: env.leadQueueRedisUsername || undefined,
    password: env.leadQueueRedisPassword || undefined,
    maxRetriesPerRequest: producer ? 1 : null,
    connectTimeout: producer ? 2_000 : 10_000,
    enableOfflineQueue: !producer,
    retryStrategy: producer
      ? (times) => (times > 2 ? null : Math.min(times * 200, 800))
      : (times) => Math.min(times * 200, 2_000),
  });
  redis.on('error', () => undefined);
  return redis;
}
