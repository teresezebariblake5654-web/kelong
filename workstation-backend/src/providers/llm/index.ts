import { createHash } from 'crypto';
import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import { MockLlmProvider } from './mock.provider';
import {
  OpenAICompatibleLlmClient,
  OpenAICompatibleLlmProvider,
  buildEndpointFromPreset,
  resolvePreset,
  type OpenAICompatibleEndpoint,
} from './openaiCompatible.provider';
import type { AiProviderId } from './providerCatalog';
import type { LlmProvider } from './types';
import {
  assertLlmAvailableForRequest,
  getLlmRuntimeState,
  normalizeLlmBaseUrl,
} from './llmRuntime';

let llmProvider: LlmProvider | undefined;
let llmProviderKey: string | undefined;
let chatClient: OpenAICompatibleLlmClient | undefined;
let chatClientKey: string | undefined;

function endpointCacheKey(endpoint: OpenAICompatibleEndpoint): string {
  // Never embed raw API key material in cache keys that might be logged.
  const keyFingerprint = createHash('sha256')
    .update(endpoint.apiKey)
    .digest('hex')
    .slice(0, 12);
  return `${endpoint.providerId}|${endpoint.baseURL}|${endpoint.model}|${keyFingerprint}`;
}

/**
 * Resolve upstream OpenAI-compatible endpoint.
 * Non-mock: MUST use LLM_BASE_URL + LLM_API_KEY (Bearer on the wire via OpenAI SDK).
 */
export function resolveLlmEndpoint(): OpenAICompatibleEndpoint {
  assertLlmAvailableForRequest();

  const providerId = env.modelProvider;
  if (providerId === 'mock') {
    throw new AppError(503, '当前为 mock 模式，未配置真实模型', 'CHAT_MODEL_NOT_CONFIGURED');
  }

  const preset = resolvePreset(providerId);
  const apiKey = env.llmApiKey.trim();
  const baseURL = normalizeLlmBaseUrl(env.llmBaseUrl);
  if (!apiKey || !baseURL) {
    throw new AppError(503, '上游模型服务暂不可用', 'LLM_PROVIDER_UNAVAILABLE');
  }

  const model =
    env.llmModel.trim() ||
    (providerId === 'openai' ? env.openaiModel : '') ||
    (providerId === 'deepseek' ? env.deepseekModel : '') ||
    undefined;

  return buildEndpointFromPreset(preset, { apiKey, baseURL, model });
}

export function getOpenAICompatibleChatClient(): OpenAICompatibleLlmClient {
  const endpoint = resolveLlmEndpoint();
  const key = endpointCacheKey(endpoint);
  if (chatClient && chatClientKey === key) return chatClient;
  chatClient = new OpenAICompatibleLlmClient(endpoint);
  chatClientKey = key;
  return chatClient;
}

export function getLlmProvider(): LlmProvider {
  const providerId: AiProviderId = env.modelProvider;
  if (providerId === 'mock') {
    const key = 'mock';
    if (llmProvider && llmProviderKey === key) return llmProvider;
    llmProvider = new MockLlmProvider();
    llmProviderKey = key;
    return llmProvider;
  }

  assertLlmAvailableForRequest();
  const key = endpointCacheKey(resolveLlmEndpoint());
  if (llmProvider && llmProviderKey === key) return llmProvider;

  llmProvider = new OpenAICompatibleLlmProvider(getOpenAICompatibleChatClient());
  llmProviderKey = key;
  return llmProvider;
}

export function getActiveLlmModel(): string {
  if (env.modelProvider === 'mock') return 'mock-task-model';
  const runtime = getLlmRuntimeState();
  if (runtime.model) return runtime.model;
  try {
    return resolveLlmEndpoint().model;
  } catch {
    return env.llmModel || env.openaiModel || env.deepseekModel || 'unknown';
  }
}

export type { LlmAnalyzeRequest, LlmAnalyzeResult, LlmProvider } from './types';
export type { AiProviderId } from './providerCatalog';
export { AI_PROVIDER_IDS, AI_PROVIDER_PRESETS } from './providerCatalog';
export { mapUpstreamLlmError } from './openaiCompatible.provider';
export {
  getLlmRuntimeState,
  initLlmRuntimeFromEnv,
  redactLlmSecrets,
} from './llmRuntime';
