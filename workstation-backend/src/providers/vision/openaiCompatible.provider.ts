import OpenAI from 'openai';
import { AppError } from '../../utils/errors';
import { ImageAnalysisOutput, ImageAnalysisProvider, ImageAnalysisRequest } from './types';

const SYSTEM_PROMPT = [
  '你是一个图片识别与分析助手。用户会提供一张图片和一条指令。',
  '请仔细观察图片内容，并以 JSON 输出，格式如下：',
  '{"summary":"图片内容概述（1-3 句话）","extractedText":"图片中识别出的所有文字，没有则为空字符串","details":["关键内容1","关键内容2"]}',
  '要求：只输出 JSON，不要输出任何其他文本或代码块标记；details 数组给出 2-8 条关键观察。',
].join('\n');

/** Errors from OpenAI-compatible gateways when the model cannot accept image input. */
const UNSUPPORTED_HINTS = [
  'image',
  'vision',
  'multimodal',
  'multi-modal',
  'content type',
  'invalid type',
  'not support',
  'unsupported',
];

function looksLikeUnsupportedImageError(message: string): boolean {
  const lower = message.toLowerCase();
  return UNSUPPORTED_HINTS.some((hint) => lower.includes(hint));
}

/** Gateway hiccups (502/503/429, overload) are worth an automatic retry. */
function looksLikeTransientError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('429') ||
    lower.includes('bad gateway') ||
    lower.includes('overloaded') ||
    lower.includes('timeout') ||
    lower.includes('timed out')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

function parseModelOutput(raw: string): ImageAnalysisOutput {
  const cleaned = stripCodeFences(raw);
  try {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    const jsonText = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    const parsed = JSON.parse(jsonText) as Partial<ImageAnalysisOutput>;
    return {
      summary: typeof parsed.summary === 'string' && parsed.summary ? parsed.summary : cleaned.slice(0, 300),
      extractedText: typeof parsed.extractedText === 'string' ? parsed.extractedText : '',
      details: Array.isArray(parsed.details)
        ? parsed.details.filter((item): item is string => typeof item === 'string')
        : [],
    };
  } catch {
    // Model replied with plain prose about the image — still a real vision answer.
    return { summary: cleaned.slice(0, 500), extractedText: '', details: [] };
  }
}

export type OpenAICompatibleVisionConfig = {
  apiKey: string;
  baseURL?: string;
  model: string;
};

export class OpenAICompatibleVisionProvider implements ImageAnalysisProvider {
  private client: OpenAI;

  constructor(private config: OpenAICompatibleVisionConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async analyzeImage(request: ImageAnalysisRequest): Promise<ImageAnalysisOutput> {
    const maxAttempts = 3;
    let response;
    for (let attempt = 1; ; attempt += 1) {
      try {
        response = await this.client.chat.completions.create({
          model: this.config.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: request.instruction },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${request.mimeType};base64,${request.imageBase64}`,
                  },
                },
              ],
            },
          ],
          temperature: 0.2,
        });
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[imageAnalysis] vision call failed (attempt ${attempt}):`, message.slice(0, 300));
        if (looksLikeUnsupportedImageError(message)) {
          throw new AppError(502, '当前智能分析服务暂不支持图片识别', 'IMAGE_ANALYSIS_UNSUPPORTED');
        }
        if (attempt < maxAttempts && looksLikeTransientError(message)) {
          await sleep(1500 * attempt);
          continue;
        }
        throw new AppError(502, '图片识别失败，请重新尝试', 'IMAGE_ANALYSIS_FAILED');
      }
    }

    const content = response.choices[0]?.message?.content;
    if (!content || !content.trim()) {
      throw new AppError(502, '图片识别失败，请重新尝试', 'IMAGE_ANALYSIS_FAILED');
    }
    return parseModelOutput(content);
  }
}
