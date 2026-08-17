import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';

export const LLM_UPSTREAM_PROVIDER_NAME = '1701';

export type LlmRuntimeState = {
  available: boolean;
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  /** Short reason for operators; never includes secrets. */
  reason: string | null;
};

let runtimeState: LlmRuntimeState = {
  available: false,
  configured: false,
  baseUrl: null,
  model: null,
  reason: 'not_initialized',
};

/** Strip secrets from any string before logging. */
export function redactLlmSecrets(text: string): string {
  return String(text ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9._\-]{6,}/gi, 'sk-***')
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"'&\s]+/gi, 'api_key=***');
}

export function normalizeLlmBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getLlmRuntimeState(): LlmRuntimeState {
  return { ...runtimeState };
}

/**
 * Validate LLM_BASE_URL (HTTPS) + LLM_API_KEY for non-mock providers.
 * Production: throw → process must not start.
 * Non-production: mark AI unavailable without crashing.
 */
export function initLlmRuntimeFromEnv(): LlmRuntimeState {
  if (env.modelProvider === 'mock') {
    runtimeState = {
      available: true,
      configured: true,
      baseUrl: null,
      model: 'mock-task-model',
      reason: 'mock',
    };
    return getLlmRuntimeState();
  }

  const baseUrl = normalizeLlmBaseUrl(env.llmBaseUrl);
  const apiKey = env.llmApiKey.trim();
  const model = env.llmModel.trim() || null;

  if (!baseUrl || !apiKey) {
    const reason = !baseUrl ? 'LLM_BASE_URL_MISSING' : 'LLM_API_KEY_MISSING';
    runtimeState = {
      available: false,
      configured: false,
      baseUrl: baseUrl || null,
      model,
      reason,
    };
    if (env.isProduction) {
      throw new Error(
        `AI upstream config invalid (${reason}): set LLM_BASE_URL (HTTPS) and LLM_API_KEY`,
      );
    }
    logger.warn('AI upstream unavailable — missing LLM_BASE_URL or LLM_API_KEY', { reason });
    return getLlmRuntimeState();
  }

  if (!isHttpsUrl(baseUrl)) {
    runtimeState = {
      available: false,
      configured: false,
      baseUrl,
      model,
      reason: 'LLM_BASE_URL_NOT_HTTPS',
    };
    if (env.isProduction) {
      throw new Error('LLM_BASE_URL must be HTTPS in production');
    }
    logger.warn('AI upstream unavailable — LLM_BASE_URL must be HTTPS', {
      baseUrl,
    });
    return getLlmRuntimeState();
  }

  runtimeState = {
    available: true,
    configured: true,
    baseUrl,
    model,
    reason: null,
  };
  logger.info('AI upstream configured', {
    provider: LLM_UPSTREAM_PROVIDER_NAME,
    baseUrl,
    model: model ?? '(default)',
    keyConfigured: true,
  });
  return getLlmRuntimeState();
}

export function assertLlmAvailableForRequest(): void {
  const state = getLlmRuntimeState();
  if (env.modelProvider === 'mock') return;
  if (!state.available || !state.configured || !state.baseUrl) {
    throw new AppError(
      503,
      '上游模型服务暂不可用，请稍后重试',
      'LLM_PROVIDER_UNAVAILABLE',
    );
  }
}

/** Origin for NewAPI management paths (strip trailing /v1). */
export function upstreamManagementOrigin(llmBaseUrl: string): string {
  const normalized = normalizeLlmBaseUrl(llmBaseUrl);
  try {
    return new URL(normalized).origin;
  } catch {
    return normalized.replace(/\/v1$/i, '');
  }
}
