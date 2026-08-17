import { LlmAnalyzeRequest, LlmAnalyzeResult, LlmProvider } from './types';

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3));
}

export class MockLlmProvider implements LlmProvider {
  async analyze(request: LlmAnalyzeRequest): Promise<LlmAnalyzeResult> {
    const data = request.structuredData ?? {};
    const anomalyCount =
      typeof data.anomalyCount === 'number'
        ? data.anomalyCount
        : Array.isArray(data.anomalies)
          ? data.anomalies.length
          : 0;
    const rowCount =
      data.meta && typeof data.meta === 'object' && 'rowCount' in data.meta
        ? Number((data.meta as Record<string, unknown>).rowCount ?? 0)
        : 0;

    const output = {
      summary: `【智能分析】已完成本地结构化结果解读。共 ${rowCount || '若干'} 行数据，识别异常 ${anomalyCount} 项。`,
      highlights: [
        '数据已通过本地清洗与模板统计',
        anomalyCount > 0 ? `建议优先处理 ${anomalyCount} 条异常标记` : '未发现高优先级异常',
        '本次结果由分析服务生成',
      ],
      anomalyCount,
      data,
    };

    return {
      output,
      provider: 'mock',
      model: request.model || 'mock-task-model',
      inputTokens: estimateTokens(
        `${request.systemPrompt}\n${JSON.stringify(request.structuredData)}`,
      ),
      outputTokens: estimateTokens(JSON.stringify(output)),
    };
  }
}
