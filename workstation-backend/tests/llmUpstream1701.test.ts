import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/utils/errors';
import {
  isHttpsUrl,
  normalizeLlmBaseUrl,
  redactLlmSecrets,
  upstreamManagementOrigin,
} from '../src/providers/llm/llmRuntime';
import { mapUpstreamLlmError } from '../src/providers/llm/openaiCompatible.provider';

describe('1701 upstream LLM — secrets + error mapping', () => {
  it('redacts Bearer tokens and sk- keys from log text', () => {
    const raw =
      'Authorization: Bearer sk-v5bhBhfE7QSXy9kHc0V3fADBHBYkT870BXXnYBgROE3vDqAV failed; also sk-OTHERSECRETVALUE';
    const scrubbed = redactLlmSecrets(raw);
    expect(scrubbed).not.toContain('sk-v5bh');
    expect(scrubbed).not.toContain('OTHERSECRET');
    expect(scrubbed).toMatch(/Bearer \*\*\*/);
    expect(scrubbed).toMatch(/sk-\*\*\*/);
  });

  it('requires HTTPS LLM_BASE_URL shape helpers', () => {
    expect(isHttpsUrl('https://1701.store/v1')).toBe(true);
    expect(isHttpsUrl('http://1701.store/v1')).toBe(false);
    expect(normalizeLlmBaseUrl('https://1701.store/v1/')).toBe('https://1701.store/v1');
    expect(upstreamManagementOrigin('https://1701.store/v1')).toBe('https://1701.store');
  });

  it('maps upstream failures to required error codes', () => {
    expect(mapUpstreamLlmError(new Error('Incorrect API key provided'), '1701').code).toBe(
      'UPSTREAM_CREDENTIAL_INVALID',
    );
    expect(mapUpstreamLlmError(new Error('insufficient_quota'), '1701').code).toBe(
      'UPSTREAM_INSUFFICIENT_QUOTA',
    );
    expect(mapUpstreamLlmError(new Error('model_not_found'), '1701').code).toBe(
      'UPSTREAM_MODEL_UNAVAILABLE',
    );
    expect(mapUpstreamLlmError(new Error('connection reset'), '1701').code).toBe(
      'LLM_PROVIDER_UNAVAILABLE',
    );
  });

  it('does not leak key material inside mapped error messages', () => {
    const err = mapUpstreamLlmError(
      new Error('auth failed for sk-ABCDEFGHIJKLMNOPQRSTUV'),
      '1701',
    );
    expect(err.message).not.toMatch(/sk-ABCDEF/);
  });
});

describe('1701 upstream probe service (mocked fetch)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('status probe uses Bearer auth and never returns the key', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(String(url)).toBe('https://1701.store/v1/models');
      expect(headers.get('Authorization')).toMatch(/^Bearer\s+\S+/);
      return new Response(JSON.stringify({ object: 'list', data: [{ id: 'gpt-5.6-sol' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { env } = await import('../src/config/env');
    const prevBase = env.llmBaseUrl;
    const prevKey = env.llmApiKey;
    const prevModel = env.llmModel;
    const prevProvider = env.modelProvider;
    env.modelProvider = 'custom';
    env.llmBaseUrl = 'https://1701.store/v1';
    env.llmApiKey = 'sk-test-key-for-probe-only';
    env.llmModel = 'gpt-5.6-sol';

    const { initLlmRuntimeFromEnv } = await import('../src/providers/llm/llmRuntime');
    initLlmRuntimeFromEnv();
    const { probeLlmProviderStatus } = await import(
      '../src/providers/llm/upstreamProbe'
    );
    const status = await probeLlmProviderStatus();

    expect(status.provider).toBe('1701');
    expect(status.baseUrl).toBe('https://1701.store/v1');
    expect(status.configured).toBe(true);
    expect(status.reachable).toBe(true);
    expect(status.modelAvailable).toBe(true);
    expect(JSON.stringify(status)).not.toContain('sk-test-key');
    expect(JSON.stringify(status)).not.toContain('Authorization');

    env.llmBaseUrl = prevBase;
    env.llmApiKey = prevKey;
    env.llmModel = prevModel;
    env.modelProvider = prevProvider;
  });

  it('quota maps NewAPI /api/usage/token into string fields', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toBe('https://1701.store/api/usage/token');
      return new Response(
        JSON.stringify({
          code: true,
          message: 'ok',
          data: {
            object: 'token_usage',
            total_granted: 1000000,
            total_used: 12345,
            total_available: 987655,
            unlimited_quota: false,
            expires_at: 0,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { env } = await import('../src/config/env');
    const prevBase = env.llmBaseUrl;
    const prevKey = env.llmApiKey;
    env.llmBaseUrl = 'https://1701.store/v1';
    env.llmApiKey = 'sk-test-key-for-quota';
    const { initLlmRuntimeFromEnv } = await import('../src/providers/llm/llmRuntime');
    initLlmRuntimeFromEnv();
    const { fetchLlmProviderQuota } = await import(
      '../src/providers/llm/upstreamProbe'
    );
    const quota = await fetchLlmProviderQuota();
    expect(quota.totalGranted).toBe('1000000');
    expect(quota.totalUsed).toBe('12345');
    expect(quota.totalAvailable).toBe('987655');
    expect(quota.unlimitedQuota).toBe(false);
    expect(quota.expiresAt).toBeNull();
    expect(JSON.stringify(quota)).not.toContain('sk-test-key');

    env.llmBaseUrl = prevBase;
    env.llmApiKey = prevKey;
  });

  it('quota failure becomes LLM_PROVIDER_UNAVAILABLE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 503 })),
    );
    const { env } = await import('../src/config/env');
    env.llmBaseUrl = 'https://1701.store/v1';
    env.llmApiKey = 'sk-test-key';
    const { initLlmRuntimeFromEnv } = await import('../src/providers/llm/llmRuntime');
    initLlmRuntimeFromEnv();
    const { fetchLlmProviderQuota } = await import(
      '../src/providers/llm/upstreamProbe'
    );
    await expect(fetchLlmProviderQuota()).rejects.toMatchObject({
      code: 'LLM_PROVIDER_UNAVAILABLE',
    } satisfies Partial<AppError>);
  });
});
