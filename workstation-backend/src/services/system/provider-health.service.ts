import crypto from 'crypto';
import Redis from 'ioredis';
import { env } from '../../config/env';
import { checkDatabaseHealth } from '../../config/database';
import { getLeadProviderHealth } from '../leads/lead-provider-health.service';
import { isSalesEmailTransportConfigured } from '../mail.service';
import { isWhatsAppChannelConfigured } from '../../providers/sales-channels/whatsapp.gateway';
import { getActiveLlmModel } from '../../providers/llm';

export type SystemHealthStatus = 'UP' | 'DOWN' | 'NOT_CONFIGURED';

export type SystemHealthItem = {
  status: SystemHealthStatus;
  durationMs?: number;
  errorCode?: string;
};

function mapLeadStatus(status: 'UP' | 'DOWN', error?: string): SystemHealthItem {
  if (error === 'not_configured') {
    return { status: 'NOT_CONFIGURED', durationMs: 0, errorCode: 'NOT_CONFIGURED' };
  }
  return {
    status,
    durationMs: undefined,
    errorCode: status === 'DOWN' ? 'PROVIDER_DOWN' : undefined,
  };
}

async function probeRedis(): Promise<SystemHealthItem> {
  const started = Date.now();
  // Dedicated short-lived client: never reuse BullMQ's infinite-retry connection.
  const redis = new Redis({
    host: env.leadQueueRedisHost,
    port: env.leadQueueRedisPort,
    db: env.leadQueueRedisDb,
    username: env.leadQueueRedisUsername || undefined,
    password: env.leadQueueRedisPassword || undefined,
    lazyConnect: true,
    connectTimeout: 1_500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    const pong = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('redis health timed out')), 2_000),
      ),
    ]);
    await redis.quit().catch(() => undefined);
    return {
      status: pong === 'PONG' ? 'UP' : 'DOWN',
      durationMs: Date.now() - started,
      errorCode: pong === 'PONG' ? undefined : 'REDIS_BAD_PONG',
    };
  } catch {
    try {
      redis.disconnect();
    } catch {
      // ignore
    }
    return {
      status: 'DOWN',
      durationMs: Date.now() - started,
      errorCode: 'REDIS_UNAVAILABLE',
    };
  }
}

async function probeLlm(): Promise<SystemHealthItem> {
  const started = Date.now();
  try {
    const model = getActiveLlmModel();
    if (!model) {
      return { status: 'NOT_CONFIGURED', durationMs: Date.now() - started, errorCode: 'LLM_NOT_CONFIGURED' };
    }
    // Config presence only — no chat completion (no business side effect).
    return { status: 'UP', durationMs: Date.now() - started };
  } catch {
    return { status: 'DOWN', durationMs: Date.now() - started, errorCode: 'LLM_UNAVAILABLE' };
  }
}

/**
 * Aggregated provider health. No outbound mail/WhatsApp/customer writes.
 */
export async function getSystemProviderHealth() {
  const [lead, db, redis, llm] = await Promise.all([
    getLeadProviderHealth(),
    checkDatabaseHealth(),
    probeRedis(),
    probeLlm(),
  ]);

  const email: SystemHealthItem = isSalesEmailTransportConfigured()
    ? { status: 'UP' }
    : { status: 'NOT_CONFIGURED', errorCode: 'EMAIL_PROVIDER_CONFIG' };

  const whatsapp: SystemHealthItem = isWhatsAppChannelConfigured()
    ? { status: 'UP' }
    : { status: 'NOT_CONFIGURED', errorCode: 'WHATSAPP_PROVIDER_CONFIG' };

  return {
    searxng: {
      status: lead.searxng.status,
      durationMs: lead.searxng.latencyMs,
      errorCode: lead.searxng.status === 'DOWN' ? 'SEARXNG_DOWN' : undefined,
    } satisfies SystemHealthItem,
    firecrawl: {
      status: lead.firecrawl.status,
      durationMs: lead.firecrawl.latencyMs,
      errorCode: lead.firecrawl.status === 'DOWN' ? 'FIRECRAWL_DOWN' : undefined,
    } satisfies SystemHealthItem,
    keelead: {
      status: lead.keelead.status,
      durationMs: lead.keelead.latencyMs,
      errorCode: lead.keelead.status === 'DOWN' ? 'KEELEAD_DOWN' : undefined,
    } satisfies SystemHealthItem,
    llm,
    email,
    whatsapp,
    redis,
    postgres: {
      status: db.ok ? 'UP' : 'DOWN',
      durationMs: db.latencyMs,
      errorCode: db.ok ? undefined : 'DATABASE_DOWN',
    } satisfies SystemHealthItem,
    meta: {
      whatsappVerifyConfigured: Boolean(env.whatsappVerifyToken),
      whatsappSignatureConfigured: Boolean(env.whatsappAppSecret),
      salesEmailWebhookConfigured: Boolean(env.salesEmailWebhookSecret),
    },
  };
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    // Still compare to avoid short-circuit timing leaks on length alone when possible.
    const fill = Buffer.alloc(left.length);
    crypto.timingSafeEqual(left, fill);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

export function verifyWhatsAppSignature(rawBody: Buffer | string, signatureHeader: string | undefined): boolean {
  if (!env.whatsappAppSecret) return false;
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = crypto
    .createHmac('sha256', env.whatsappAppSecret)
    .update(typeof rawBody === 'string' ? rawBody : rawBody)
    .digest('hex');
  const provided = signatureHeader.slice('sha256='.length);
  return timingSafeEqualString(expected, provided);
}
