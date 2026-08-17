import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import { resolveLlmEndpoint } from '../llm';
import { OpenAICompatibleVisionProvider } from './openaiCompatible.provider';
import { ImageAnalysisProvider } from './types';

let provider: ImageAnalysisProvider | undefined;
let providerKey: string | undefined;

/**
 * 图片识别同样走当前通用 LLM 接入点（OpenAI 兼容协议）。
 * mock 无视觉能力，直接拒绝。
 */
export function getImageAnalysisProvider(): ImageAnalysisProvider {
  if (env.modelProvider === 'mock') {
    throw new AppError(503, '当前智能分析服务暂不支持图片识别', 'IMAGE_ANALYSIS_UNSUPPORTED');
  }

  let endpoint;
  try {
    endpoint = resolveLlmEndpoint();
  } catch {
    throw new AppError(503, '当前智能分析服务暂不支持图片识别', 'IMAGE_ANALYSIS_UNSUPPORTED');
  }

  const key = `${endpoint.providerId}|${endpoint.baseURL}|${endpoint.model}`;
  if (provider && providerKey === key) return provider;

  provider = new OpenAICompatibleVisionProvider({
    apiKey: endpoint.apiKey,
    baseURL: endpoint.baseURL,
    model: endpoint.model,
  });
  providerKey = key;
  return provider;
}

export type { ImageAnalysisOutput, ImageAnalysisProvider, ImageAnalysisRequest } from './types';
