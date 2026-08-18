import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { env } from '../../config/env';
import type { LeadProviderMetricsCollector } from '../../services/leads/lead-provider-metrics';

export const providerMetricsStore = new AsyncLocalStorage<LeadProviderMetricsCollector>();

export type ProviderRetryMetricSink = {
  record(event: {
    provider: string;
    ok: boolean;
    retries: number;
    durationMs: number;
  }): void;
};

function extraRetryLimit(): number {
  return Math.min(Math.max(env.leadProviderRetryAttempts ?? 2, 0), 3);
}

export function isConfiguredMissingError(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  return /_NOT_CONFIGURED|_KEY_NOT_CONFIGURED$|LLM_PROVIDER_UNAVAILABLE|CHAT_MODEL_NOT_CONFIGURED/.test(
    err.code,
  );
}

export function isTransientProviderError(err: unknown, httpStatus?: number): boolean {
  if (httpStatus === 408 || httpStatus === 429) return true;
  if (typeof httpStatus === 'number' && httpStatus >= 500) return true;
  if (isConfiguredMissingError(err)) return false;
  if (err instanceof AppError) {
    if (err.statusCode === 408 || err.statusCode === 429) return true;
    if (err.statusCode >= 500) return true;
    if (err.statusCode >= 400 && err.statusCode < 500) return false;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /timed out|timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed|network|429|503|502|504/i.test(
    message,
  );
}

function backoffMs(attempt: number): number {
  const baseMs = Math.max(50, env.leadProviderRetryBaseMs || 250);
  const base = Math.min(baseMs * 2 ** attempt, 2_000);
  const jitter = Math.floor(Math.random() * Math.max(40, Math.floor(baseMs * 0.5)));
  return base + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withProviderRetry<T>(input: {
  provider: 'searxng' | 'firecrawl' | 'keelead' | 'llm';
  op: string;
  fn: () => Promise<T>;
  extraAttempts?: number;
  metrics?: ProviderRetryMetricSink;
}): Promise<T> {
  const extra = input.extraAttempts ?? extraRetryLimit();
  const started = Date.now();
  let retries = 0;
  let lastErr: unknown;
  const maxAttempts = extra + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await input.fn();
      const durationMs = Date.now() - started;
      const sink = input.metrics ?? providerMetricsStore.getStore();
      sink?.record({
        provider: input.provider,
        ok: true,
        retries,
        durationMs,
      });
      logger.info('[LeadProvider]', {
        provider: input.provider,
        op: input.op,
        attempt,
        status: 'ok',
        durationMs,
        retries,
      });
      return result;
    } catch (err) {
      lastErr = err;
      const transient = isTransientProviderError(err);
      logger.warn('[LeadProvider]', {
        provider: input.provider,
        op: input.op,
        attempt,
        status: 'error',
        retry: transient && attempt < maxAttempts,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!transient || attempt >= maxAttempts) break;
      retries += 1;
      await sleep(backoffMs(attempt - 1));
    }
  }

  const sink = input.metrics ?? providerMetricsStore.getStore();
  sink?.record({
    provider: input.provider,
    ok: false,
    retries,
    durationMs: Date.now() - started,
  });
  throw lastErr;
}
