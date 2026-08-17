import { dayStamp, writeBusinessWorkbook } from '../shared/excelExport.js';
import { matchHeader, num, pickSheet, str } from '../shared/fieldMatch.js';
import type {
  ProductionDeliverable,
  ProductionException,
  ProductionWorkflowResult,
  RunProductionWorkflowInput,
} from '../shared/types.js';

export const TASK_CODE = 'quality_exception_close' as const;

type QualityLine = {
  batch: string;
  product: string;
  line: string;
  inspected: number;
  defects: number;
  defectRate: number;
  defectType: string;
  scrapQty: number;
  reworkQty: number;
  remark: string;
  sourceFile: string;
  sourceRow: number;
};

function parse(input: RunProductionWorkflowInput): QualityLine[] {
  const lines: QualityLine[] = [];
  for (const wb of input.workbooks) {
    const sheet = pickSheet(wb, ['质检', '不良', '完工', '返工', '报废', '质量']);
    const batchH = matchHeader(sheet.headers, ['批次', '生产批次', '批号']);
    const productH = matchHeader(sheet.headers, ['产品', '产品名称', '物料', 'SKU']);
    const lineH = matchHeader(sheet.headers, ['产线', '生产线', '车间']);
    const inspH = matchHeader(sheet.headers, ['检验数量', '生产数量', '完工数量', '总数']);
    const defectH = matchHeader(sheet.headers, ['不良数量', '不合格数', '缺陷数']);
    const typeH = matchHeader(sheet.headers, ['缺陷类型', '不良原因', '问题类型']);
    const scrapH = matchHeader(sheet.headers, ['报废数量', '废品数量']);
    const reworkH = matchHeader(sheet.headers, ['返工数量', '返修数量']);
    const remarkH = matchHeader(sheet.headers, ['备注', '说明', '描述']);
    sheet.rows.forEach((row, i) => {
      const inspected = num(row, inspH);
      const defects = num(row, defectH);
      if (!inspected && !defects && !str(row, productH)) return;
      const defectRate = inspected > 1e-9 ? defects / inspected : defects > 0 ? 1 : 0;
      lines.push({
        batch: str(row, batchH) || `B-${i + 1}`,
        product: str(row, productH),
        line: str(row, lineH),
        inspected,
        defects,
        defectRate,
        defectType: str(row, typeH),
        scrapQty: num(row, scrapH),
        reworkQty: num(row, reworkH),
        remark: str(row, remarkH),
        sourceFile: wb.fileName,
        sourceRow: i + 1,
      });
    });
  }
  return lines;
}

function classifyText(text: string): string {
  if (/裂纹|破损|变形/.test(text)) return '外观缺陷';
  if (/尺寸|超差|公差/.test(text)) return '尺寸不良';
  if (/混料|错料/.test(text)) return '用料错误';
  if (text) return '待分类';
  return '未填写';
}

export function runQualityExceptionClose(input: RunProductionWorkflowInput): ProductionWorkflowResult {
  const generatedAt = new Date().toISOString();
  let lines = parse(input);
  for (const action of input.actions ?? []) {
    lines = lines.map((l) => {
      if (action.materialCode && l.batch !== action.materialCode && l.product !== action.materialCode) return l;
      if (action.action === 'confirm' && /报废/.test(action.code)) return { ...l, scrapQty: l.defects };
      if (action.action === 'modify_quantity' && action.value != null) {
        const defects = Number(action.value);
        if (!Number.isFinite(defects)) return l;
        return {
          ...l,
          defects,
          defectRate: l.inspected > 1e-9 ? defects / l.inspected : 0,
        };
      }
      return l;
    });
  }

  const threshold = 0.03;
  const hot = lines.filter((l) => l.defectRate > threshold || l.defects > 0);
  const ignored = new Set((input.actions ?? []).filter((a) => a.action === 'ignore_once').map((a) => a.materialCode));
  const exceptions: ProductionException[] = hot
    .filter((l) => !ignored.has(l.batch))
    .map((l) => ({
      code: l.defectRate > threshold ? 'HIGH_DEFECT_RATE' : 'HAS_DEFECT',
      severity: l.defectRate > threshold ? ('critical' as const) : ('warning' as const),
      message: `批次 ${l.batch} 不良率 ${(l.defectRate * 100).toFixed(2)}%（${l.defectType || classifyText(l.remark)}）`,
      materialCode: l.batch,
      materialName: l.product,
      line: l.line,
      value: l.defects,
    }));

  const disposition = hot.map((l) => ({
    批次: l.batch,
    产品: l.product,
    产线: l.line,
    检验数量: l.inspected,
    不良数量: l.defects,
    不良率: Math.round(l.defectRate * 10000) / 10000,
    缺陷类型: l.defectType || classifyText(l.remark),
    AI分类: classifyText(l.defectType || l.remark),
    处置建议: l.scrapQty > 0 ? '报废审批' : l.reworkQty > 0 ? '返工' : '待判定',
    来源文件: l.sourceFile,
    原始行号: l.sourceRow,
  }));

  return {
    taskCode: TASK_CODE,
    generatedAt,
    blocked: !input.workbooks.length,
    clarifications: input.workbooks.length ? [] : [{ id: 'need', message: '请上传质检/不良/完工/返工报废记录' }],
    exceptions,
    summary: {
      lineCount: lines.length,
      defectLots: hot.length,
      totalDefects: lines.reduce((s, l) => s + l.defects, 0),
      scrapLots: lines.filter((l) => l.scrapQty > 0).length,
      reworkLots: lines.filter((l) => l.reworkQty > 0).length,
      exceptionCount: exceptions.length,
      processedRecordCount: lines.length,
      autoClosedCount: Math.max(0, lines.length - exceptions.length),
      manualConfirmCount: exceptions.length,
    },
    tables: {
      disposition,
      rework: lines
        .filter((l) => l.reworkQty > 0 || (l.defects > 0 && l.scrapQty === 0))
        .map((l) => ({
          批次: l.batch,
          产品: l.product,
          返工数量: l.reworkQty || l.defects,
          缺陷类型: l.defectType || classifyText(l.remark),
          来源文件: l.sourceFile,
          原始行号: l.sourceRow,
        })),
      scrap: lines
        .filter((l) => l.scrapQty > 0 || /报废/.test(l.remark + l.defectType))
        .map((l) => ({
          批次: l.batch,
          产品: l.product,
          报废数量: l.scrapQty || l.defects,
          备注: l.remark,
          AI分类: classifyText(l.remark || l.defectType),
          人工确认状态: (input.actions ?? []).some((a) => a.materialCode === l.batch && a.action === 'confirm')
            ? '已确认'
            : '待确认',
          来源文件: l.sourceFile,
          原始行号: l.sourceRow,
        })),
      batchTrack: hot.map((l) => ({
        批次: l.batch,
        产品: l.product,
        不良数量: l.defects,
        跟踪状态: '异常批次跟踪中',
        来源文件: l.sourceFile,
        原始行号: l.sourceRow,
      })),
      manual: exceptions.map((e) => ({
        异常类型: e.code,
        批次: e.materialCode || '-',
        产品: e.materialName || '-',
        异常原因: e.message,
        人工确认状态: '待确认',
      })),
    },
    appliedActions: input.actions,
    aiPayload: {
      taskCode: TASK_CODE,
      sampleExceptions: exceptions.slice(0, 20),
      note: '不良率由本地计算；AI 仅可做文字分类，禁止改数量。',
    },
  };
}

export function buildQualityExceptionDeliverables(result: ProductionWorkflowResult): ProductionDeliverable[] {
  const day = dayStamp(result.generatedAt);
  return [
    { kind: 'disposition', fileName: `质量异常处置单_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.disposition ?? [], '质量异常处置单') },
    { kind: 'rework', fileName: `返工任务单_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.rework ?? [], '返工任务单') },
    { kind: 'scrap', fileName: `报废待审批单_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.scrap ?? [], '报废待审批单') },
    { kind: 'batch', fileName: `异常批次跟踪单_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.batchTrack ?? [], '异常批次跟踪单') },
    { kind: 'manual', fileName: `人工确认清单_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.manual ?? [], '人工确认清单') },
  ];
}
