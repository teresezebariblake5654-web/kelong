export type LlmAnalyzeRequest = {
  systemPrompt: string;
  structuredData: Record<string, unknown>;
  model: string;
  maxOutputTokens: number;
};

export type LlmAnalyzeResult = {
  output: unknown;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export interface LlmProvider {
  analyze(request: LlmAnalyzeRequest): Promise<LlmAnalyzeResult>;
}
