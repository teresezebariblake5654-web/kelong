import { AppError } from '../../utils/errors';
import { env } from '../../config/env';
import {
  LLM_UPSTREAM_PROVIDER_NAME,
  getLlmRuntimeState,
  normalizeLlmBaseUrl,
  redactLlmSecrets,
  upstreamManagementOrigin,
} from './llmRuntime';

const PROBE_TIMEOUT_MS = 8_000;

export type LlmProviderStatus = {
  provider: typeof LLM_UPSTREAM_PROVIDER_NAME;
  baseUrl: string;
  configured: boolean;
  reachable: boolean;
  modelAvailable: boolean;
  checkedAt: string;
  errorCode: string | null;
};

export type LlmProviderQuota = {
  totalGranted: string;
  totalUsed: string;
  totalAvailable: string;
  unlimitedQuota: boolean;
  expiresAt: string | null;
  checkedAt: string;
};

function asStringAmount(value: unknown): string {
  if (value == null) return '0';
  if (typeof value === 'string') return value.trim() || '0';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return '0';
}

function expiresAtIso(value: unknown): string | null {
  if (value == null || value === 0 || value === '0' || value === -1 || value === '-1') {
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1_000_000_000_000 ? n : n * 1000;
  return new Date(ms).toISOString();
}

async function fetchUpstream(
  url: string,
  apiKey: string,
): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const bodyText = await response.text();
    return { ok: response.ok, status: response.status, bodyText };
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonSafe(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function mapProbeHttpError(status: number, bodyText: string): string {
  const lower = redactLlmSecrets(bodyText).toLowerCase();
  if (status === 401 || status === 403) return 'UPSTREAM_CREDENTIAL_INVALID';
  if (
    status === 402 ||
    lower.includes('insufficient') ||
    lower.includes('quota') ||
    lower.includes('balance')
  ) {
    return 'UPSTREAM_INSUFFICIENT_QUOTA';
  }
  if (status === 404 || (lower.includes('model') && lower.includes('not'))) {
    return 'UPSTREAM_MODEL_UNAVAILABLE';
  }
  return 'LLM_PROVIDER_UNAVAILABLE';
}

/** GET {LLM_BASE_URL}/models — never returns/logs the API key. */
export async function probeLlmProviderStatus(): Promise<LlmProviderStatus> {
  const checkedAt = new Date().toISOString();
  const runtime = getLlmRuntimeState();
  const baseUrl =
    runtime.baseUrl ||
    (env.llmBaseUrl.trim() ? normalizeLlmBaseUrl(env.llmBaseUrl) : '');
  const configured = Boolean(baseUrl && env.llmApiKey.trim());

  if (!configured || !baseUrl) {
    return {
      provider: LLM_UPSTREAM_PROVIDER_NAME,
      baseUrl: baseUrl || '',
      configured: false,
      reachable: false,
      modelAvailable: false,
      checkedAt,
      errorCode: 'LLM_PROVIDER_UNAVAILABLE',
    };
  }

  try {
    const result = await fetchUpstream(`${baseUrl}/models`, env.llmApiKey.trim());
    if (!result.ok) {
      return {
        provider: LLM_UPSTREAM_PROVIDER_NAME,
        baseUrl,
        configured: true,
        reachable: result.status > 0 && result.status < 500,
        modelAvailable: false,
        checkedAt,
        errorCode: mapProbeHttpError(result.status, result.bodyText),
      };
    }

    const payload = parseJsonSafe(result.bodyText) as {
      data?: unknown;
      object?: string;
    } | null;
    const hasModels =
      Array.isArray(payload?.data) ||
      payload?.object === 'list' ||
      (payload != null && typeof payload === 'object');

    const preferred = env.llmModel.trim();
    let modelAvailable = hasModels;
    if (preferred && Array.isArray(payload?.data)) {
      modelAvailable = payload.data.some((item) => {
        if (!item || typeof item !== 'object') return false;
        const id = (item as { id?: unknown }).id;
        return typeof id === 'string' && id === preferred;
      });
      if (!modelAvailable && payload.data.length === 0) modelAvailable = true;
    }

    return {
      provider: LLM_UPSTREAM_PROVIDER_NAME,
      baseUrl,
      configured: true,
      reachable: true,
      modelAvailable,
      checkedAt,
      errorCode: modelAvailable ? null : 'UPSTREAM_MODEL_UNAVAILABLE',
    };
  } catch {
    return {
      provider: LLM_UPSTREAM_PROVIDER_NAME,
      baseUrl,
      configured: true,
      reachable: false,
      modelAvailable: false,
      checkedAt,
      errorCode: 'LLM_PROVIDER_UNAVAILABLE',
    };
  }
}

/** NewAPI platform token quota — https://doc.newapi.pro/api/token-usage/ */
export async function fetchLlmProviderQuota(): Promise<LlmProviderQuota> {
  const checkedAt = new Date().toISOString();
  const runtime = getLlmRuntimeState();
  const baseUrl =
    runtime.baseUrl ||
    (env.llmBaseUrl.trim() ? normalizeLlmBaseUrl(env.llmBaseUrl) : '');
  const apiKey = env.llmApiKey.trim();

  if (!baseUrl || !apiKey) {
    throw new AppError(503, '上游模型服务暂不可用', 'LLM_PROVIDER_UNAVAILABLE');
  }

  const url = `${upstreamManagementOrigin(baseUrl)}/api/usage/token`;
  let result: { ok: boolean; status: number; bodyText: string };
  try {
    result = await fetchUpstream(url, apiKey);
  } catch {
    throw new AppError(503, '上游模型服务暂不可用', 'LLM_PROVIDER_UNAVAILABLE');
  }

  if (!result.ok) {
    const code = mapProbeHttpError(result.status, result.bodyText);
    throw new AppError(
      code === 'UPSTREAM_CREDENTIAL_INVALID' ? 502 : 503,
      '上游模型服务暂不可用',
      code === 'UPSTREAM_CREDENTIAL_INVALID' ? code : 'LLM_PROVIDER_UNAVAILABLE',
    );
  }

  const payload = parseJsonSafe(result.bodyText) as {
    data?: Record<string, unknown>;
  } | null;

  const data = (payload?.data && typeof payload.data === 'object'
    ? payload.data
    : payload) as Record<string, unknown> | null;

  if (!data) {
    throw new AppError(503, '上游模型服务暂不可用', 'LLM_PROVIDER_UNAVAILABLE');
  }

  return {
    totalGranted: asStringAmount(data.total_granted ?? data.totalGranted),
    totalUsed: asStringAmount(data.total_used ?? data.totalUsed),
    totalAvailable: asStringAmount(data.total_available ?? data.totalAvailable ?? data.quota),
    unlimitedQuota: Boolean(data.unlimited_quota ?? data.unlimitedQuota),
    expiresAt: expiresAtIso(data.expires_at ?? data.expiresAt),
    checkedAt,
  };
}
