import { Tool, ToolContext, ToolResult } from './types';

interface SheetSummary {
  name: string;
  rowCount: number;
  headers: string[];
  numericColumns: string[];
  sampleStats: Record<string, { min?: number; max?: number; avg?: number; count: number }>;
}

function summarizeSheet(sheet: {
  name: string;
  headers: string[];
  rowCount: number;
  rows: Record<string, unknown>[];
}): SheetSummary {
  const numericColumns: string[] = [];
  const sampleStats: SheetSummary['sampleStats'] = {};

  for (const header of sheet.headers) {
    const values = sheet.rows
      .map((row) => row[header])
      .filter((v): v is number => typeof v === 'number');

    if (values.length > 0) {
      numericColumns.push(header);
      sampleStats[header] = {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        count: values.length,
      };
    }
  }

  return {
    name: sheet.name,
    rowCount: sheet.rowCount,
    headers: sheet.headers,
    numericColumns,
    sampleStats,
  };
}

export const summarizeTableTool: Tool = {
  name: 'summarizeTable',
  description: '对 Excel 表格数据进行统计摘要',
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const parsedData = input.parsedData ?? context.parsedData;
    if (!parsedData || typeof parsedData !== 'object') {
      return { name: 'summarizeTable', success: false, error: '缺少已解析的表格数据' };
    }

    const data = parsedData as { sheets?: Array<{ name: string; headers: string[]; rowCount: number; rows: Record<string, unknown>[] }> };
    if (!data.sheets?.length) {
      return { name: 'summarizeTable', success: false, error: '没有可摘要的工作表' };
    }

    const summaries = data.sheets.map(summarizeSheet);
    const totalRows = summaries.reduce((sum, s) => sum + s.rowCount, 0);

    return {
      name: 'summarizeTable',
      success: true,
      data: {
        totalSheets: summaries.length,
        totalRows,
        sheets: summaries,
      },
    };
  },
};
