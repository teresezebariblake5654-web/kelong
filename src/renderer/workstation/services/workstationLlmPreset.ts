/**
 * Foolproof 1701.store preset for workstation onboarding.
 * Users only paste an API key; URL / format / default model are fixed.
 */

import { ApiFormat, type ProviderConfig } from '@shared/providers';
import type { AppConfig } from '@/config';
import { configService } from '@/services/config';
import { coworkService } from '@/services/cowork';

export const WORKSTATION_LLM_BASE_URL = 'https://1701.store/v1';
export const WORKSTATION_LLM_PROVIDER = 'custom_0';
export const WORKSTATION_LLM_DISPLAY_NAME = '1701';
export const WORKSTATION_LLM_DEFAULT_MODEL = {
  id: 'gpt-5.6-sol',
  name: 'gpt-5.6-sol',
  supportsImage: true,
  contextWindow: 1_050_000,
} as const;

export const WORKSTATION_LLM_KEY_REQUEST_EVENT = 'workstation:request-llm-key';

export function requestWorkstationLlmKeyGate(): void {
  window.dispatchEvent(new CustomEvent(WORKSTATION_LLM_KEY_REQUEST_EVENT));
}

function providerHasKey(provider: ProviderConfig | undefined | null): boolean {
  return Boolean(provider?.enabled && provider.apiKey?.trim() && provider.baseUrl?.trim());
}

/** True when the user still needs to paste a usable LLM key. */
export function needsWorkstationLlmKey(config?: AppConfig): boolean {
  const cfg = config ?? configService.getConfig();
  const providers = cfg.providers ?? {};

  const defaultProviderKey =
    cfg.model?.defaultModelProvider?.trim() || WORKSTATION_LLM_PROVIDER;
  if (providerHasKey(providers[defaultProviderKey as keyof typeof providers])) {
    return false;
  }
  if (providerHasKey(providers[WORKSTATION_LLM_PROVIDER])) {
    return false;
  }

  for (const provider of Object.values(providers)) {
    if (providerHasKey(provider)) return false;
  }

  if (cfg.api?.key?.trim() && cfg.api?.baseUrl?.trim()) {
    return false;
  }

  return true;
}

export function buildWorkstationLlmProviderConfig(apiKey: string): ProviderConfig {
  const key = apiKey.trim();
  return {
    enabled: true,
    apiKey: key,
    baseUrl: WORKSTATION_LLM_BASE_URL,
    apiFormat: ApiFormat.OpenAI,
    displayName: WORKSTATION_LLM_DISPLAY_NAME,
    models: [
      {
        id: WORKSTATION_LLM_DEFAULT_MODEL.id,
        name: WORKSTATION_LLM_DEFAULT_MODEL.name,
        supportsImage: WORKSTATION_LLM_DEFAULT_MODEL.supportsImage,
        contextWindow: WORKSTATION_LLM_DEFAULT_MODEL.contextWindow,
      },
    ],
  };
}

/** Persist key into custom_0 + set as default model (same path as Settings). */
export async function applyWorkstationLlmKey(apiKey: string): Promise<void> {
  const key = apiKey.trim();
  if (!key) {
    throw new Error('请粘贴 API Key');
  }

  const existing = configService.getConfig();
  const nextProvider = buildWorkstationLlmProviderConfig(key);

  await configService.updateConfig({
    api: {
      key,
      baseUrl: WORKSTATION_LLM_BASE_URL,
    },
    model: {
      ...existing.model,
      defaultModel: WORKSTATION_LLM_DEFAULT_MODEL.id,
      defaultModelProvider: WORKSTATION_LLM_PROVIDER,
    },
    providers: {
      ...(existing.providers ?? {}),
      [WORKSTATION_LLM_PROVIDER]: nextProvider,
    },
  });
}

export type ProbeWorkstationLlmResult = {
  ok: boolean;
  error?: string;
};

/** Optional connectivity check after save. */
export async function probeWorkstationLlmKey(): Promise<ProbeWorkstationLlmResult> {
  try {
    const result = await coworkService.checkApiConfig({ probeModel: true });
    if (!result) {
      return { ok: true };
    }
    if (result.hasConfig && !result.error) {
      return { ok: true };
    }
    return {
      ok: false,
      error: result.error?.trim() || 'Key 无效或网络不通，请检查后重试',
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Key 无效或网络不通，请检查后重试',
    };
  }
}
