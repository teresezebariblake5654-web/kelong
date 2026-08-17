import { env } from '../config/env';
import { AppError } from '../utils/errors';
import { getActiveLlmModel, getOpenAICompatibleChatClient } from '../providers/llm';

export interface GenerateReportInput {
  systemPrompt: string;
  userPrompt: string;
  history?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  model?: string;
  jsonMode?: boolean;
}

export interface GenerateReportResult {
  content: string;
  provider: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

function buildMockHrReport(userPrompt: string): string {
  const taskPreview = userPrompt.trim().slice(0, 200) || '未提供具体任务描述';

  return `# 数据分析报告

> 本报告由 mock 模型生成，用于本地联调。

## 一、数据概览
- 已接收用户任务：${taskPreview}
- 当前为 mock 模式，未调用真实大模型 API

## 二、关键发现
- 数据已完成基础读取与预览（mock）
- 建议接入真实模型后重新生成结论

## 三、管理建议
1. 在 backend/.env 设置 MODEL_PROVIDER（openai/deepseek/qwen/moonshot/zhipu/siliconflow/custom）
2. 填写 LLM_API_KEY（或对应厂商 KEY）与可选 LLM_BASE_URL / LLM_MODEL
3. 重启后端后重新运行分析
`;
}

async function generateMockReport(input: GenerateReportInput): Promise<GenerateReportResult> {
  const content = buildMockHrReport(input.userPrompt);
  return {
    content,
    provider: 'mock',
    model: input.model || 'mock-hr-model',
    usage: {
      inputTokens: estimateTokens(`${input.systemPrompt}\n${input.userPrompt}`),
      outputTokens: estimateTokens(content),
    },
  };
}

/**
 * 统一聊天/报告生成入口：走 OpenAI 兼容通用客户端，
 * 支持 OpenAI / DeepSeek / 通义 / Kimi / 智谱 / SiliconFlow / 自定义网关。
 */
export const modelProviderService = {
  async generateReport(input: GenerateReportInput): Promise<GenerateReportResult> {
    if (env.modelProvider === 'mock') {
      return generateMockReport(input);
    }

    try {
      const client = getOpenAICompatibleChatClient();
      const result = await client.chat({
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        history: input.history,
        model: input.model || getActiveLlmModel(),
        temperature: 0.3,
        jsonMode: input.jsonMode ?? false,
      });
      return {
        content: result.content,
        provider: result.provider,
        model: result.model,
        usage: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      const message = error instanceof Error ? error.message : '未知错误';
      console.error('[modelProvider] chat failed:', message.slice(0, 300));
      throw new AppError(502, '分析服务暂时不可用，请稍后重试', 'MODEL_PROVIDER_ERROR');
    }
  },
};
