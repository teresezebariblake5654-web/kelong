import OpenAI from 'openai';
import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import type { AiProviderId, AiProviderPreset } from './providerCatalog';
import { AI_PROVIDER_PRESETS } from './providerCatalog';
import { redactLlmSecrets } from './llmRuntime';
import type { LlmAnalyzeRequest, LlmAnalyzeResult, LlmProvider } from './types';

export type OpenAICompatibleEndpoint = {
  providerId: Exclude<AiProviderId, 'mock'>;
  label: string;
  apiKey: string;
  baseURL: string;
  model: string;
  preferJsonObject: boolean;
};

export type ChatCompletionInput = {
  systemPrompt: string;
  userPrompt: string;
  history?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  /** 需要 JSON 对象时开启；不支持的模型会自动降级为纯文本再解析 */
  jsonMode?: boolean;
};

export type ChatCompletionResult = {
  content: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

function estimateTokens(text: string): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

/** 从模型回复中尽量提取 JSON（兼容带说明文字 / markdown 代码块） */
export function extractJsonObject(raw: string): unknown {
  const cleaned = stripCodeFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new AppError(502, '分析服务返回的内容不是有效 JSON', 'INVALID_LLM_JSON');
  }
}

function looksLikeJsonFormatUnsupported(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('response_format') ||
    lower.includes('json_object') ||
    lower.includes('json mode') ||
    (lower.includes('json') && lower.includes('not support')) ||
    (lower.includes('unsupported') && lower.includes('json'))
  );
}

function looksLikeAuthError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('incorrect api key') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid_api_key') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication') ||
    lower.includes('invalid bearer') ||
    lower.includes('token not found') ||
    (lower.includes('invalid') && lower.includes('token'))
  );
}

function looksLikeQuotaError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('insufficient_quota') ||
    lower.includes('insufficient quota') ||
    lower.includes('quota exceeded') ||
    lower.includes('余额不足') ||
    lower.includes('额度不足') ||
    lower.includes('pre_consume_token') ||
    (lower.includes('quota') && (lower.includes('exceed') || lower.includes('insufficient')))
  );
}

function looksLikeModelUnavailable(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('model_not_found') ||
    lower.includes('model not found') ||
    lower.includes('does not exist') ||
    lower.includes('no available channel') ||
    (lower.includes('model') && lower.includes('unavailable'))
  );
}

function looksLikeRateLimit(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('429')
  );
}

function looksLikeParamError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('invalid_request') ||
    lower.includes('invalid parameter') ||
    lower.includes('invalid_param') ||
    lower.includes('bad request') ||
    (lower.includes('400') && lower.includes('invalid'))
  );
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String((error as { name?: unknown }).name ?? '') : '';
  const message = error instanceof Error ? error.message : String(error);
  return name === 'AbortError' || /aborted|timeout/i.test(message);
}

/** Map upstream OpenAI-compatible failures to stable AppError codes (no local debit side-effects). */
export function mapUpstreamLlmError(error: unknown, providerLabel: string): AppError {
  if (error instanceof AppError) return error;
  if (isAbortError(error)) {
    return new AppError(504, '上游模型请求超时，请稍后重试', 'LLM_TIMEOUT');
  }
  const raw = error instanceof Error ? error.message : String(error);
  const message = redactLlmSecrets(raw);
  console.error(`[LLM:${providerLabel}] request failed:`, message.slice(0, 400));

  if (looksLikeAuthError(message)) {
    return new AppError(502, '上游模型凭证无效', 'UPSTREAM_CREDENTIAL_INVALID');
  }
  if (looksLikeQuotaError(message)) {
    return new AppError(502, '上游模型额度不足', 'UPSTREAM_INSUFFICIENT_QUOTA');
  }
  if (looksLikeRateLimit(message)) {
    return new AppError(429, '上游模型请求过于频繁', 'UPSTREAM_RATE_LIMITED');
  }
  if (looksLikeParamError(message)) {
    return new AppError(400, '上游模型请求参数无效', 'UPSTREAM_INVALID_REQUEST');
  }
  if (looksLikeModelUnavailable(message)) {
    return new AppError(502, '上游模型不可用', 'UPSTREAM_MODEL_UNAVAILABLE');
  }
  return new AppError(502, '上游模型服务暂不可用，请稍后重试', 'LLM_PROVIDER_UNAVAILABLE');
}

function mapProviderError(error: unknown, providerLabel: string): AppError {
  return mapUpstreamLlmError(error, providerLabel);
}

function shouldRetryLlmError(error: unknown): boolean {
  if (error instanceof AppError) {
    return !['LLM_TIMEOUT', 'UPSTREAM_CREDENTIAL_INVALID', 'UPSTREAM_INSUFFICIENT_QUOTA', 'UPSTREAM_RATE_LIMITED', 'UPSTREAM_INVALID_REQUEST'].includes(
      error.code,
    );
  }
  if (isAbortError(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  if (
    looksLikeAuthError(message)
    || looksLikeQuotaError(message)
    || looksLikeRateLimit(message)
    || looksLikeParamError(message)
  ) {
    return false;
  }
  return true;
}

async function withTimeoutAbort<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 通用 OpenAI Chat Completions 兼容客户端。
 * OpenAI / DeepSeek / 通义 / Kimi / 智谱 / SiliconFlow / 自建网关均可接入。
 */
export class OpenAICompatibleLlmClient {
  private client: OpenAI;

  constructor(private readonly endpoint: OpenAICompatibleEndpoint) {
    this.client = new OpenAI({
      apiKey: endpoint.apiKey,
      baseURL: endpoint.baseURL,
      timeout: env.llmRequestTimeoutMs,
    });
  }

  getEndpoint(): OpenAICompatibleEndpoint {
    return this.endpoint;
  }

  async chat(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const model = input.model?.trim() || this.endpoint.model;
    const wantJson = Boolean(input.jsonMode && this.endpoint.preferJsonObject);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: input.systemPrompt },
      ...(input.history ?? []).map(
        (message): OpenAI.Chat.ChatCompletionMessageParam => ({
          role: message.role,
          content: message.content,
        }),
      ),
      { role: 'user', content: input.userPrompt },
    ];

    const runOnce = async (useJsonFormat: boolean) =>
      withTimeoutAbort(
        (signal) =>
          this.client.chat.completions.create(
            {
              model,
              messages,
              temperature: input.temperature ?? 0.2,
              ...(input.maxOutputTokens ? { max_tokens: input.maxOutputTokens } : {}),
              ...(useJsonFormat ? { response_format: { type: 'json_object' as const } } : {}),
            },
            { signal },
          ),
        env.llmRequestTimeoutMs,
      );

    const runWithRetry = async (useJsonFormat: boolean) => {
      try {
        return await runOnce(useJsonFormat);
      } catch (error) {
        const mapped = mapProviderError(error, this.endpoint.label);
        if (!shouldRetryLlmError(mapped)) {
          throw mapped;
        }
        // At most one retry for transient failures.
        try {
          return await runOnce(useJsonFormat);
        } catch (retryError) {
          throw mapProviderError(retryError, this.endpoint.label);
        }
      }
    };

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await runWithRetry(wantJson);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (wantJson && looksLikeJsonFormatUnsupported(message)) {
        console.warn(
          `[LLM:${this.endpoint.label}] json_object unsupported, fallback to plain text`,
        );
        try {
          response = await runWithRetry(false);
        } catch (retryError) {
          throw mapProviderError(retryError, this.endpoint.label);
        }
      } else {
        throw mapProviderError(error, this.endpoint.label);
      }
    }

    const content = response.choices[0]?.message?.content ?? '';
    if (!content.trim()) {
      throw new AppError(502, '分析服务返回空结果', 'EMPTY_LLM_RESPONSE');
    }

    return {
      content,
      provider: this.endpoint.providerId,
      model,
      inputTokens:
        response.usage?.prompt_tokens ??
        estimateTokens(`${input.systemPrompt}\n${input.userPrompt}`),
      outputTokens: response.usage?.completion_tokens ?? estimateTokens(content),
    };
  }
}

/** 结构化分析适配：强制要求可解析为 JSON 的输出 */
export class OpenAICompatibleLlmProvider implements LlmProvider {
  constructor(private readonly client: OpenAICompatibleLlmClient) {}

  async analyze(request: LlmAnalyzeRequest): Promise<LlmAnalyzeResult> {
    const systemPrompt = [
      request.systemPrompt,
      '',
      '请严格输出一个 JSON 对象，不要输出 markdown 代码块或其它说明文字。',
      'JSON 至少包含 summary（字符串），可包含 highlights（字符串数组）、anomalyCount（数字）、data（对象）。',
    ].join('\n');

    const result = await this.client.chat({
      systemPrompt,
      userPrompt: JSON.stringify(request.structuredData),
      model: request.model,
      maxOutputTokens: request.maxOutputTokens,
      temperature: 0.2,
      jsonMode: true,
    });

    let output: unknown;
    try {
      output = extractJsonObject(result.content);
    } catch {
      // 最后兜底：保证下游 schema 至少有 summary
      output = {
        summary: result.content.slice(0, 4000),
        highlights: [],
        anomalyCount: 0,
        data: {},
      };
    }

    return {
      output,
      provider: result.provider,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  }
}

export function resolvePreset(providerId: AiProviderId): AiProviderPreset {
  if (providerId === 'mock') {
    throw new AppError(500, 'mock provider has no OpenAI-compatible preset', 'UNKNOWN_AI_PROVIDER');
  }
  const preset = AI_PROVIDER_PRESETS[providerId];
  if (!preset) {
    throw new AppError(500, `Unknown AI provider: ${providerId}`, 'UNKNOWN_AI_PROVIDER');
  }
  return preset;
}

export function buildEndpointFromPreset(
  preset: AiProviderPreset,
  options: { apiKey: string; baseURL?: string; model?: string },
): OpenAICompatibleEndpoint {
  return {
    providerId: preset.id,
    label: preset.label,
    apiKey: options.apiKey,
    baseURL: (options.baseURL?.trim() || preset.defaultBaseUrl).replace(/\/+$/, ''),
    model: options.model?.trim() || preset.defaultModel,
    preferJsonObject: preset.preferJsonObject !== false,
  };
}
