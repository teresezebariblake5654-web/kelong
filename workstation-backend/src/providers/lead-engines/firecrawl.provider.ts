import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import type { FirecrawlScrapeResult } from './lead-provider.types';

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

function firecrawlHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (env.firecrawlApiKey) {
    headers.Authorization = `Bearer ${env.firecrawlApiKey}`;
  }
  return headers;
}

function requireBase(): string {
  const base = env.firecrawlBaseUrl.replace(/\/$/, '');
  if (!base) {
    throw new AppError(503, 'FIRECRAWL_BASE_URL is not configured', 'FIRECRAWL_NOT_CONFIGURED');
  }
  return base;
}

/**
 * Firecrawl scrape HTTP client — POST /v1/scrape
 * Maps only fields present in the Firecrawl response. No invented company/emails.
 */
export async function scrapeWebsite(targetUrl: string): Promise<FirecrawlScrapeResult> {
  const base = requireBase();

  const res = await withTimeout(
    fetch(`${base}/v1/scrape`, {
      method: 'POST',
      headers: firecrawlHeaders(),
      body: JSON.stringify({
        url: targetUrl,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
    }),
    env.firecrawlTimeoutMs,
    'firecrawl',
  );

  const text = await res.text();
  let body: {
    success?: boolean;
    error?: string;
    data?: {
      markdown?: string;
      metadata?: Record<string, unknown> & { title?: string; sourceURL?: string };
      url?: string;
    };
  };
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError(502, `Firecrawl returned non-JSON (${res.status})`, 'FIRECRAWL_BAD_RESPONSE');
  }

  if (!res.ok || body.success === false) {
    throw new AppError(
      502,
      body.error || `Firecrawl HTTP ${res.status}`,
      'FIRECRAWL_HTTP_ERROR',
    );
  }

  const data = body.data ?? {};
  const metadata =
    data.metadata && typeof data.metadata === 'object' ? { ...data.metadata } : {};
  const title =
    (typeof metadata.title === 'string' && metadata.title) ||
    (typeof data.markdown === 'string'
      ? data.markdown.split('\n').find((l) => l.trim())?.replace(/^#\s*/, '').slice(0, 200) || ''
      : '');

  return {
    url:
      (typeof metadata.sourceURL === 'string' && metadata.sourceURL) ||
      (typeof data.url === 'string' && data.url) ||
      targetUrl,
    title,
    markdown: typeof data.markdown === 'string' ? data.markdown : '',
    metadata,
  };
}

/**
 * Firecrawl map — POST /v1/map
 * Returns real discovered links only. Failures should be handled by caller.
 */
export async function mapWebsite(targetUrl: string): Promise<string[]> {
  const base = requireBase();

  const res = await withTimeout(
    fetch(`${base}/v1/map`, {
      method: 'POST',
      headers: firecrawlHeaders(),
      body: JSON.stringify({
        url: targetUrl,
        limit: 50,
      }),
    }),
    Math.min(env.firecrawlTimeoutMs, 30_000),
    'firecrawl-map',
  );

  const text = await res.text();
  let body: { success?: boolean; error?: string; links?: unknown };
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError(502, `Firecrawl map returned non-JSON (${res.status})`, 'FIRECRAWL_MAP_BAD_RESPONSE');
  }

  if (!res.ok || body.success === false) {
    throw new AppError(
      502,
      body.error || `Firecrawl map HTTP ${res.status}`,
      'FIRECRAWL_MAP_HTTP_ERROR',
    );
  }

  if (!Array.isArray(body.links)) return [];
  return body.links.filter((l): l is string => typeof l === 'string' && /^https?:\/\//i.test(l));
}

export const firecrawlProvider = {
  scrapeWebsite,
  mapWebsite,
};
