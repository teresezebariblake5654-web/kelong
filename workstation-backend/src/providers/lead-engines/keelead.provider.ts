import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import type { KeeleadVerificationResult } from './lead-provider.types';

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

/**
 * KeeLead Provider HTTP client — verify_email only (no search_leads).
 */
export async function verifyEmail(email: string): Promise<KeeleadVerificationResult> {
  const base = env.keeleadBaseUrl.replace(/\/$/, '');
  if (!base) {
    throw new AppError(503, 'KEELEAD_BASE_URL is not configured', 'KEELEAD_NOT_CONFIGURED');
  }
  if (!env.keeleadProviderKey) {
    throw new AppError(503, 'KEELEAD_PROVIDER_KEY is not configured', 'KEELEAD_KEY_NOT_CONFIGURED');
  }

  const res = await withTimeout(
    fetch(`${base}/api/provider/v1/verify_email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.keeleadProviderKey}`,
      },
      body: JSON.stringify({ email }),
    }),
    env.keeleadTimeoutMs,
    'keelead',
  );

  const text = await res.text();
  let body: {
    success?: boolean;
    data?: { results?: Array<Record<string, unknown>>; notes?: string[] };
    error?: { code?: string; message?: string };
  };
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError(502, `KeeLead returned non-JSON (${res.status})`, 'KEELEAD_BAD_RESPONSE');
  }

  if (!res.ok || body.success === false) {
    throw new AppError(
      res.status === 401 ? 502 : 502,
      body.error?.message || `KeeLead HTTP ${res.status}`,
      body.error?.code || 'KEELEAD_HTTP_ERROR',
    );
  }

  const first = body.data?.results?.[0];
  if (!first || typeof first.email !== 'string') {
    throw new AppError(502, 'KeeLead verify_email returned no result', 'KEELEAD_EMPTY_RESULT');
  }

  return {
    email: first.email,
    score: typeof first.score === 'number' ? first.score : 0,
    status: typeof first.status === 'string' ? first.status : 'unknown',
    layers: Array.isArray(first.layers) ? first.layers : undefined,
    details:
      first.details && typeof first.details === 'object'
        ? (first.details as Record<string, unknown>)
        : undefined,
    suggestion: typeof first.suggestion === 'string' ? first.suggestion : undefined,
    notes: body.data?.notes,
    raw: first,
  };
}

export const keeleadProvider = {
  verifyEmail,
};
