/**
 * 主流大模型厂商预设（均为 OpenAI Chat Completions 兼容协议）。
 * 通过 MODEL_PROVIDER + LLM_API_KEY / LLM_BASE_URL / LLM_MODEL 即可切换。
 */
export const AI_PROVIDER_IDS = [
  'mock',
  'openai',
  'deepseek',
  'qwen',
  'moonshot',
  'zhipu',
  'siliconflow',
  'custom',
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export type AiProviderPreset = {
  id: Exclude<AiProviderId, 'mock'>;
  label: string;
  /** 默认 API Base URL（可被 LLM_BASE_URL / 厂商专用变量覆盖） */
  defaultBaseUrl: string;
  /** 默认模型名 */
  defaultModel: string;
  /** 是否优先尝试 response_format=json_object（不支持时会自动降级） */
  preferJsonObject: boolean;
};

export const AI_PROVIDER_PRESETS: Record<Exclude<AiProviderId, 'mock'>, AiProviderPreset> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    preferJsonObject: true,
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    preferJsonObject: true,
  },
  qwen: {
    id: 'qwen',
    label: '通义千问 (DashScope)',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    preferJsonObject: true,
  },
  moonshot: {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    preferJsonObject: false,
  },
  zhipu: {
    id: 'zhipu',
    label: '智谱 GLM',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    preferJsonObject: false,
  },
  siliconflow: {
    id: 'siliconflow',
    label: 'SiliconFlow',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    preferJsonObject: true,
  },
  custom: {
    id: 'custom',
    label: '自定义 OpenAI 兼容网关',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    preferJsonObject: false,
  },
};

export function isAiProviderId(value: string): value is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value);
}
