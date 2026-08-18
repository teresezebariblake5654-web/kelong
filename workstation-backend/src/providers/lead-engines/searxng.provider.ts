import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import type { SearxngSearchHit } from './lead-provider.types';
import { withProviderRetry } from './provider-retry';

const BLOCKED_HOST_PARTS = [
  'youtube.com',
  'youtu.be',
  'reddit.com',
  'github.com',
  'npmjs.com',
  'npmjs.org',
  'wikipedia.org',
];

export function normalizeDomainFromUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (!/^https?:$/i.test(u.protocol)) return null;
    u.hash = '';
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

export function isBlockedLeadHost(domain: string): boolean {
  const d = domain.toLowerCase();
  return BLOCKED_HOST_PARTS.some((part) => d === part || d.endsWith(`.${part}`));
}

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

export type SearchWebCompaniesInput = {
  query: string;
  limit?: number;
};

/**
 * SearXNG HTTP client — GET /search?format=json
 * Does not invent companies; maps real results only.
 */
export async function searchWebCompanies(
  input: SearchWebCompaniesInput,
): Promise<SearxngSearchHit[]> {
  return withProviderRetry({
    provider: 'searxng',
    op: 'search',
    fn: () => searchWebCompaniesOnce(input),
  });
}

async function searchWebCompaniesOnce(
  input: SearchWebCompaniesInput,
): Promise<SearxngSearchHit[]> {
  const base = env.searxngBaseUrl.replace(/\/$/, '');
  if (!base) {
    throw new AppError(503, 'SEARXNG_BASE_URL is not configured', 'SEARXNG_NOT_CONFIGURED');
  }

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const url = new URL(`${base}/search`);
  url.searchParams.set('q', input.query);
  url.searchParams.set('format', 'json');

  const res = await withTimeout(
    fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }),
    env.searxngTimeoutMs,
    'searxng',
  );

  if (!res.ok) {
    throw new AppError(
      502,
      `SearXNG HTTP ${res.status}`,
      'SEARXNG_HTTP_ERROR',
    );
  }

  const body = (await res.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      engine?: string;
      engines?: string[];
    }>;
  };

  const hits: SearxngSearchHit[] = [];
  for (const r of body.results ?? []) {
    if (!r.url) continue;
    let cleanedUrl: string;
    try {
      const u = new URL(r.url);
      u.hash = '';
      cleanedUrl = u.toString();
    } catch {
      continue;
    }
    const domain = normalizeDomainFromUrl(cleanedUrl);
    if (!domain || isBlockedLeadHost(domain)) continue;

    hits.push({
      title: typeof r.title === 'string' ? r.title : '',
      url: cleanedUrl,
      domain,
      description: typeof r.content === 'string' ? r.content : '',
      engine:
        (typeof r.engine === 'string' && r.engine) ||
        (Array.isArray(r.engines) && r.engines[0]) ||
        'searxng',
    });
    if (hits.length >= limit) break;
  }

  return hits;
}

export const searxngProvider = {
  searchWebCompanies,
  normalizeDomainFromUrl,
  isBlockedLeadHost,
};
