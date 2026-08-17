import { Tool, ToolContext, ToolResult } from './types';

export const generateReportTool: Tool = {
  name: 'generateReport',
  description: '根据分析结果生成报告结构',
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const summary = input.summary as Record<string, unknown> | undefined;
    const taskDescription = (input.taskDescription as string) ?? context.taskDescription ?? '数据分析任务';

    const title = `分析报告：${taskDescription.slice(0, 50)}`;
    const sections = [
      '概述',
      '数据概况',
      '关键发现',
      '详细分析',
      '建议与后续行动',
    ];

    return {
      name: 'generateReport',
      success: true,
      data: {
        title,
        sections,
        summarySnapshot: summary ?? null,
        generatedAt: new Date().toISOString(),
      },
    };
  },
};
