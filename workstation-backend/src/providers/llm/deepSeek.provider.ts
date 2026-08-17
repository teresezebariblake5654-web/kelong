import OpenAI from 'openai';
import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import { LlmAnalyzeRequest, LlmAnalyzeResult, LlmProvider } from './types';

export class DeepSeekProvider implements LlmProvider {
  private client?: OpenAI;

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: env.deepseekApiKey,
        baseURL: env.deepseekBaseUrl,
      });
    }
    return this.client;
  }

  async analyze(request: LlmAnalyzeRequest): Promise<LlmAnalyzeResult> {
    if (!env.deepseekApiKey) {
      throw new AppError(500, '分析服务暂未配置完成', 'DEEPSEEK_NOT_CONFIGURED');
    }

    try {
      const response = await this.getClient().chat.completions.create({
        model: request.model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: JSON.stringify(request.structuredData) },
        ],
        max_tokens: request.maxOutputTokens,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      });
      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new AppError(502, '分析服务返回空结果', 'EMPTY_LLM_RESPONSE');
      }

      let output: unknown;
      try {
        output = JSON.parse(content);
      } catch {
        throw new AppError(502, '分析服务返回的内容不是有效 JSON', 'INVALID_LLM_JSON');
      }

      return {
        output,
        provider: 'deepseek',
        model: request.model,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error('[DeepSeekProvider] request failed');
      throw new AppError(502, '分析服务暂时不可用，请稍后重试', 'MODEL_PROVIDER_ERROR');
    }
  }
}
