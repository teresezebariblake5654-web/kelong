import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export type ProviderHealthStatus = 'UP' | 'DOWN';

export type ProviderHealthItem = {
  status: ProviderHealthStatus;
  latencyMs: number;
  error?: string;
};

export type LeadProviderHealthResult = {
  searxng: ProviderHealthItem;
  firecrawl: ProviderHealthItem;
  keelead: ProviderHealthItem;
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function probe(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<ProviderHealthItem> {
  const started = Date.now();
  try {
    const res = await withTimeout(
      fetch(url, { method: 'GET', headers: { Accept: 'application/json', ...(headers ?? {}) } }),
      timeoutMs,
      'health',
    );
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return { status: 'DOWN', latencyMs, error: `HTTP ${res.status}` };
    }
    return { status: 'UP', latencyMs };
  } catch (err) {
    return {
      status: 'DOWN',
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getLeadProviderHealth(): Promise<LeadProviderHealthResult> {
  const timeoutMs = 5_000;
  const searxngBase = env.searxngBaseUrl.replace(/\/$/, '');
  const firecrawlBase = env.firecrawlBaseUrl.replace(/\/$/, '');
  const keeleadBase = env.keeleadBaseUrl.replace(/\/$/, '');

  const [searxng, firecrawl, keelead] = await Promise.all([
    searxngBase
      ? probe(`${searxngBase}/healthz`, timeoutMs).then(async (first) =>
          first.status === 'UP' ? first : probe(`${searxngBase}/`, timeoutMs),
        )
      : Promise.resolve({ status: 'DOWN' as const, latencyMs: 0, error: 'not_configured' }),
    firecrawlBase
      ? probe(`${firecrawlBase}/v1/health`, timeoutMs).then(async (first) =>
          first.status === 'UP'
            ? first
            : probe(`${firecrawlBase}/health`, timeoutMs),
        )
      : Promise.resolve({ status: 'DOWN' as const, latencyMs: 0, error: 'not_configured' }),
    keeleadBase
      ? probe(`${keeleadBase}/health`, timeoutMs)
      : Promise.resolve({ status: 'DOWN' as const, latencyMs: 0, error: 'not_configured' }),
  ]);

  logger.info('[LeadProvider]', {
    op: 'health',
    searxng: searxng.status,
    firecrawl: firecrawl.status,
    keelead: keelead.status,
  });

  return { searxng, firecrawl, keelead };
}

export const leadProviderHealthService = {
  getLeadProviderHealth,
};
