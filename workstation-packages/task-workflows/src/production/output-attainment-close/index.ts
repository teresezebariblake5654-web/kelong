import { dayStamp, writeBusinessWorkbook } from '../shared/excelExport.js';
import { matchHeader, num, pickSheet, str } from '../shared/fieldMatch.js';
import type {
  ProductionDeliverable,
  ProductionException,
  ProductionWorkflowResult,
  RunProductionWorkflowInput,
} from '../shared/types.js';

export const TASK_CODE = 'output_attainment_close' as const;

type OutputLine = {
  workOrder: string;
  product: string;
  line: string;
  team: string;
  planned: number;
  actual: number;
  rate: number;
  gap: number;
  sourceFile: string;
  sourceRow: number;
};

function parse(input: RunProductionWorkflowInput): OutputLine[] {
  const lines: OutputLine[] = [];
  for (const wb of input.workbooks) {
    const sheet = pickSheet(wb, ['计划', '工单', '完工', '班组', '产线', '产量']);
    const woH = matchHeader(sheet.headers, ['工单号', '生产工单', '订单号']);
    const productH = matchHeader(sheet.headers, ['产品', '产品名称', '物料', 'SKU']);
    const lineH = matchHeader(sheet.headers, ['产线', '生产线', '车间']);
    const teamH = matchHeader(sheet.headers, ['班组', '班次', '小组']);
    const planH = matchHeader(sheet.headers, ['计划产量', '计划数量', '目标产量', '工单数量']);
    const actualH = matchHeader(sheet.headers, ['实际产量', '完工数量', '完成数量', '产量', '报工数量']);
    sheet.rows.forEach((row, i) => {
      const planned = num(row, planH);
      const actual = num(row, actualH);
      if (!planned && !actual && !str(row, productH)) return;
      const rate = planned > 1e-9 ? actual / planned : actual > 0 ? 1 : 0;
      lines.push({
        workOrder: str(row, woH) || `ROW-${i + 1}`,
        product: str(row, productH),
        line: str(row, lineH),
        team: str(row, teamH),
        planned,
        actual,
        rate,
        gap: Math.round((planned - actual) * 1000) / 1000,
        sourceFile: wb.fileName,
        sourceRow: i + 1,
      });
    });
  }
  return lines;
}

export function runOutputAttainmentClose(input: RunProductionWorkflowInput): ProductionWorkflowResult {
  const generatedAt = new Date().toISOString();
  let lines = parse(input);
  for (const action of input.actions ?? []) {
    lines = lines.map((l) => {
      if (action.workOrder && l.workOrder !== action.workOrder) return l;
      if (action.action === 'modify_quantity' && action.value != null) {
        const actual = Number(action.value);
        if (!Number.isFinite(actual)) return l;
        const rate = l.planned > 1e-9 ? actual / l.planned : 0;
        return { ...l, actual, rate, gap: Math.round((l.planned - actual) * 1000) / 1000 };
      }
      return l;
    });
  }

  const threshold = 0.9;
  const missed = lines.filter((l) => l.planned > 0 && l.rate + 1e-9 < threshold);
  const ignored = new Set((input.actions ?? []).filter((a) => a.action === 'ignore_once').map((a) => a.workOrder));
  const exceptions: ProductionException[] = missed
    .filter((l) => !ignored.has(l.workOrder))
    .map((l) => ({
      code: 'LOW_ATTAINMENT',
      severity: 'critical' as const,
      message: `${l.workOrder} 达成率 ${(l.rate * 100).toFixed(1)}%（缺口 ${l.gap}）`,
      workOrder: l.workOrder,
      line: l.line,
      value: l.gap,
    }));

  return {
    taskCode: TASK_CODE,
    generatedAt,
    blocked: !input.workbooks.length,
    clarifications: input.workbooks.length ? [] : [{ id: 'need', message: '请上传计划/工单/完工/班组产线记录' }],
    exceptions,
    summary: {
      lineCount: lines.length,
      missedCount: missed.length,
      totalGap: Math.round(lines.reduce((s, l) => s + Math.max(0, l.gap), 0) * 1000) / 1000,
      avgRate: lines.length
        ? Math.round((lines.reduce((s, l) => s + l.rate, 0) / lines.length) * 10000) / 10000
        : 0,
      exceptionCount: exceptions.length,
      processedRecordCount: lines.length,
      autoClosedCount: Math.max(0, lines.length - exceptions.length),
      manualConfirmCount: exceptions.length,
    },
    tables: {
      detail: lines.map((l) => ({
        工单号: l.workOrder,
        产品: l.product,
        产线: l.line,
        班组: l.team,
        计划产量: l.planned,
        实际产量: l.actual,
        达成率: Math.round(l.rate * 10000) / 10000,
        产量缺口: l.gap,
        来源文件: l.sourceFile,
        原始行号: l.sourceRow,
      })),
      missed: missed.map((l) => ({
        工单号: l.workOrder,
        产品: l.product,
        产线: l.line,
        计划产量: l.planned,
        实际产量: l.actual,
        达成率: Math.round(l.rate * 10000) / 10000,
        异常原因: '达成率低于 90%',
        来源文件: l.sourceFile,
        原始行号: l.sourceRow,
      })),
      gap: missed.map((l) => ({
        工单号: l.workOrder,
        产品: l.product,
        产量缺口: l.gap,
        处理建议: '安排加班/调线/改计划',
        来源文件: l.sourceFile,
        原始行号: l.sourceRow,
      })),
      manual: exceptions.map((e) => ({
        异常类型: e.code,
        工单号: e.workOrder || '-',
        异常原因: e.message,
        相关数量: e.value ?? '',
        人工确认状态: '待确认',
      })),
    },
    appliedActions: input.actions,
    aiPayload: {
      taskCode: TASK_CODE,
      sampleExceptions: exceptions.slice(0, 20),
      note: '达成率由本地计算，禁止上传完整生产表。',
    },
  };
}

export function buildOutputAttainmentDeliverables(result: ProductionWorkflowResult): ProductionDeliverable[] {
  const day = dayStamp(result.generatedAt);
  return [
    { kind: 'detail', fileName: `今日产量达成明细_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.detail ?? [], '今日产量达成明细') },
    { kind: 'missed', fileName: `未达成工单_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.missed ?? [], '未达成工单') },
    { kind: 'gap', fileName: `产量缺口处理单_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.gap ?? [], '产量缺口处理单') },
    { kind: 'manual', fileName: `人工确认清单_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.manual ?? [], '人工确认清单') },
  ];
}
