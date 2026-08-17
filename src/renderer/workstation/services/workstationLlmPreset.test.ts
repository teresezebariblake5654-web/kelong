import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@/config';
import { ApiFormat } from '@shared/providers';

const updateConfig = vi.fn(async (_config: Partial<AppConfig>) => undefined);
const getConfig = vi.fn();

vi.mock('@/services/config', () => ({
  configService: {
    getConfig: () => getConfig(),
    updateConfig: (config: Partial<AppConfig>) => updateConfig(config),
  },
}));

vi.mock('@/services/cowork', () => ({
  coworkService: {
    checkApiConfig: vi.fn(async () => ({ hasConfig: true, config: null })),
  },
}));

import {
  applyWorkstationLlmKey,
  buildWorkstationLlmProviderConfig,
  needsWorkstationLlmKey,
  WORKSTATION_LLM_BASE_URL,
  WORKSTATION_LLM_DEFAULT_MODEL,
  WORKSTATION_LLM_PROVIDER,
} from './workstationLlmPreset';

function emptyConfig(): AppConfig {
  return {
    api: { key: '', baseUrl: '' },
    model: { defaultModel: '', defaultModelProvider: '' },
    providers: {},
  } as AppConfig;
}

describe('workstationLlmPreset', () => {
  beforeEach(() => {
    updateConfig.mockClear();
    getConfig.mockReset();
    getConfig.mockReturnValue(emptyConfig());
  });

  it('needs key when nothing is configured', () => {
    expect(needsWorkstationLlmKey(emptyConfig())).toBe(true);
  });

  it('does not need key when custom_0 has apiKey', () => {
    const config = emptyConfig();
    config.providers = {
      custom_0: buildWorkstationLlmProviderConfig('sk-test'),
    };
    expect(needsWorkstationLlmKey(config)).toBe(false);
  });

  it('does not need key when another enabled provider has credentials', () => {
    const config = emptyConfig();
    config.providers = {
      deepseek: {
        enabled: true,
        apiKey: 'sk-ds',
        baseUrl: 'https://api.deepseek.com',
        apiFormat: ApiFormat.OpenAI,
        models: [{ id: 'deepseek-chat', name: 'deepseek-chat' }],
      },
    };
    expect(needsWorkstationLlmKey(config)).toBe(false);
  });

  it('applyWorkstationLlmKey writes 1701 preset onto custom_0', async () => {
    const existing = emptyConfig();
    existing.providers = {
      deepseek: {
        enabled: false,
        apiKey: '',
        baseUrl: '',
        models: [],
      },
    };
    getConfig.mockReturnValue(existing);

    await applyWorkstationLlmKey('  sk-user-key  ');

    expect(updateConfig).toHaveBeenCalledTimes(1);
    const payload = updateConfig.mock.calls[0]?.[0] as Partial<AppConfig>;
    expect(payload.api).toEqual({
      key: 'sk-user-key',
      baseUrl: WORKSTATION_LLM_BASE_URL,
    });
    expect(payload.model?.defaultModel).toBe(WORKSTATION_LLM_DEFAULT_MODEL.id);
    expect(payload.model?.defaultModelProvider).toBe(WORKSTATION_LLM_PROVIDER);
    expect(payload.providers?.[WORKSTATION_LLM_PROVIDER]).toMatchObject({
      enabled: true,
      apiKey: 'sk-user-key',
      baseUrl: WORKSTATION_LLM_BASE_URL,
      apiFormat: ApiFormat.OpenAI,
      displayName: '1701',
    });
    expect(payload.providers?.deepseek).toBeDefined();
  });

  it('rejects empty api key', async () => {
    await expect(applyWorkstationLlmKey('   ')).rejects.toThrow('请粘贴 API Key');
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
