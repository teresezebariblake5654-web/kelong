import { dayStamp, writeBusinessWorkbook } from '../shared/excelExport.js';
import { matchHeader, num, pickSheet, str } from '../shared/fieldMatch.js';
import type {
  AppliedProductionAction,
  ProductionDeliverable,
  ProductionException,
  ProductionWorkflowResult,
  RawWorkbook,
  RunProductionWorkflowInput,
} from '../shared/types.js';

export const TASK_CODE = 'material_variance_close' as const;

const BOM_ALIASES = ['物料编码', '料号', '物料名称', '品名', '标准用量', '定额用量', '单位用量', 'BOM用量'];
const OUTPUT_ALIASES = ['合格产量', '实际产量', '完工数量', '产量', '产品编码', '产品名称'];
const ISSUE_ALIASES = ['领料数量', '领用量', '出库数量', '发料数量'];
const RETURN_ALIASES = ['退料数量', '退库数量'];
const SCRAP_ALIASES = ['报废数量', '废料数量', '损耗数量'];

type VarianceLine = {
  materialCode: string;
  materialName: string;
  productCode: string;
  productName: string;
  standardUsage: number;
  goodOutput: number;
  theoreticalUsage: number;
  issued: number;
  returned: number;
  scrap: number;
  actualUsage: number;
  variance: number;
  varianceRate: number;
  sourceFile: string;
  sourceRow: number;
};

function findWorkbook(workbooks: RawWorkbook[], keywords: string[]): RawWorkbook | null {
  return (
    workbooks.find((wb) => keywords.some((k) => wb.fileName.includes(k) || wb.sheets.some((s) => s.sheetName.includes(k)))) ??
    null
  );
}

function parseBom(wb: RawWorkbook): Array<{ materialCode: string; materialName: string; productCode: string; standardUsage: number; sourceFile: string; sourceRow: number }> {
  const sheet = pickSheet(wb, ['BOM', '标准', '定额', '用量']);
  const codeH = matchHeader(sheet.headers, ['物料编码', '料号', '物料代码']);
  const nameH = matchHeader(sheet.headers, ['物料名称', '品名', '原料']);
  const productH = matchHeader(sheet.headers, ['产品编码', '产品', '成品编码', 'SKU']);
  const stdH = matchHeader(sheet.headers, ['标准用量', '定额用量', '单位用量', 'BOM用量']);
  return sheet.rows.map((row, i) => ({
    materialCode: str(row, codeH) || str(row, nameH),
    materialName: str(row, nameH) || str(row, codeH),
    productCode: str(row, productH) || 'DEFAULT',
    standardUsage: num(row, stdH),
    sourceFile: wb.fileName,
    sourceRow: i + 1,
  }));
}

function parseOutput(wb: RawWorkbook): Array<{ productCode: string; productName: string; goodOutput: number }> {
  const sheet = pickSheet(wb, ['产量', '完工', '产出']);
  const productH = matchHeader(sheet.headers, ['产品编码', '产品名称', '产品', 'SKU', '物料编码']);
  const nameH = matchHeader(sheet.headers, ['产品名称', '品名']);
  const qtyH = matchHeader(sheet.headers, ['合格产量', '实际产量', '完工数量', '产量', '完成数量']);
  const map = new Map<string, { productCode: string; productName: string; goodOutput: number }>();
  for (const row of sheet.rows) {
    const productCode = str(row, productH) || 'DEFAULT';
    const prev = map.get(productCode) ?? {
      productCode,
      productName: str(row, nameH) || productCode,
      goodOutput: 0,
    };
    prev.goodOutput += num(row, qtyH);
    map.set(productCode, prev);
  }
  return [...map.values()];
}

function parseQtyByMaterial(wb: RawWorkbook | null, qtyAliases: string[]): Map<string, { name: string; qty: number; file: string; rows: number[] }> {
  const map = new Map<string, { name: string; qty: number; file: string; rows: number[] }>();
  if (!wb) return map;
  const sheet = pickSheet(wb, qtyAliases);
  const codeH = matchHeader(sheet.headers, ['物料编码', '料号', '物料代码']);
  const nameH = matchHeader(sheet.headers, ['物料名称', '品名', '原料']);
  const qtyH = matchHeader(sheet.headers, qtyAliases);
  sheet.rows.forEach((row, i) => {
    const code = str(row, codeH) || str(row, nameH);
    if (!code) return;
    const prev = map.get(code) ?? { name: str(row, nameH) || code, qty: 0, file: wb.fileName, rows: [] };
    prev.qty += num(row, qtyH);
    prev.rows.push(i + 1);
    map.set(code, prev);
  });
  return map;
}

function computeLines(workbooks: RawWorkbook[]): VarianceLine[] {
  const bomWb =
    findWorkbook(workbooks, ['BOM', '标准', '定额']) ??
    workbooks.find((w) => w.sheets.some((s) => matchHeader(s.headers, BOM_ALIASES))) ??
    workbooks[0];
  const outWb =
    findWorkbook(workbooks, ['产量', '完工', '产出']) ??
    workbooks.find((w) => w.sheets.some((s) => matchHeader(s.headers, OUTPUT_ALIASES))) ??
    workbooks[1] ??
    workbooks[0];
  const issueWb =
    findWorkbook(workbooks, ['领料', '发料', '出库']) ??
    workbooks.find((w) => w.sheets.some((s) => matchHeader(s.headers, ISSUE_ALIASES)));
  const returnWb =
    findWorkbook(workbooks, ['退料', '退库']) ??
    workbooks.find((w) => w.sheets.some((s) => matchHeader(s.headers, RETURN_ALIASES)));
  const scrapWb =
    findWorkbook(workbooks, ['报废', '废料']) ??
    workbooks.find((w) => w.sheets.some((s) => matchHeader(s.headers, SCRAP_ALIASES)));

  if (!bomWb || !outWb) return [];

  const bom = parseBom(bomWb);
  const outputs = parseOutput(outWb);
  const outputByProduct = new Map(outputs.map((o) => [o.productCode, o]));
  const issued = parseQtyByMaterial(issueWb ?? null, ISSUE_ALIASES);
  const returned = parseQtyByMaterial(returnWb ?? null, RETURN_ALIASES);
  const scrap = parseQtyByMaterial(scrapWb ?? null, SCRAP_ALIASES);

  const lines: VarianceLine[] = [];
  for (const item of bom) {
    const out = outputByProduct.get(item.productCode) ?? outputByProduct.get('DEFAULT') ?? {
      productCode: item.productCode,
      productName: item.productCode,
      goodOutput: 0,
    };
    const theoreticalUsage = Math.round(out.goodOutput * item.standardUsage * 1000) / 1000;
    const issuedQty = issued.get(item.materialCode)?.qty ?? 0;
    const returnedQty = returned.get(item.materialCode)?.qty ?? 0;
    const scrapQty = scrap.get(item.materialCode)?.qty ?? 0;
    const actualUsage = Math.round((issuedQty - returnedQty) * 1000) / 1000;
    const variance = Math.round((actualUsage - theoreticalUsage) * 1000) / 1000;
    const varianceRate = theoreticalUsage > 1e-9 ? variance / theoreticalUsage : actualUsage > 0 ? 1 : 0;
    lines.push({
      materialCode: item.materialCode,
      materialName: item.materialName || issued.get(item.materialCode)?.name || item.materialCode,
      productCode: out.productCode,
      productName: out.productName,
      standardUsage: item.standardUsage,
      goodOutput: out.goodOutput,
      theoreticalUsage,
      issued: issuedQty,
      returned: returnedQty,
      scrap: scrapQty,
      actualUsage,
      variance,
      varianceRate,
      sourceFile: item.sourceFile,
      sourceRow: item.sourceRow,
    });
  }
  return lines;
}

function buildExceptions(lines: VarianceLine[], threshold = 0.05): ProductionException[] {
  const exceptions: ProductionException[] = [];
  for (const line of lines) {
    if (line.varianceRate > threshold) {
      exceptions.push({
        code: 'EXCESS_CONSUMPTION',
        severity: 'critical',
        message: `${line.materialName} 超耗 ${(line.varianceRate * 100).toFixed(1)}%（差异 ${line.variance}）`,
        materialCode: line.materialCode,
        materialName: line.materialName,
        value: line.variance,
      });
    }
    if (line.issued > 0 && line.returned > line.issued) {
      exceptions.push({
        code: 'INVALID_RETURN',
        severity: 'warning',
        message: `${line.materialName} 退料大于领料`,
        materialCode: line.materialCode,
        materialName: line.materialName,
        value: line.returned - line.issued,
      });
    }
    if (line.actualUsage < -1e-9) {
      exceptions.push({
        code: 'NEGATIVE_ACTUAL',
        severity: 'critical',
        message: `${line.materialName} 实际消耗为负`,
        materialCode: line.materialCode,
        materialName: line.materialName,
        value: line.actualUsage,
      });
    }
    if (line.issued > line.theoreticalUsage * 1.5 + 1e-9 && line.theoreticalUsage > 0) {
      exceptions.push({
        code: 'ABNORMAL_ISSUE',
        severity: 'warning',
        message: `${line.materialName} 领料异常偏高`,
        materialCode: line.materialCode,
        materialName: line.materialName,
        value: line.issued,
      });
    }
  }
  return exceptions;
}

function applyActions(lines: VarianceLine[], actions: AppliedProductionAction[]): VarianceLine[] {
  if (!actions.length) return lines;
  return lines.map((line) => {
    const related = actions.filter((a) => a.materialCode === line.materialCode);
    if (!related.length) return line;
    let next = { ...line };
    for (const action of related) {
      if (action.action === 'ignore_once') continue;
      if (action.action === 'modify_quantity' && action.value != null) {
        const qty = Number(action.value);
        if (Number.isFinite(qty)) {
          next.actualUsage = qty;
          next.variance = Math.round((next.actualUsage - next.theoreticalUsage) * 1000) / 1000;
          next.varianceRate =
            next.theoreticalUsage > 1e-9 ? next.variance / next.theoreticalUsage : 0;
        }
      }
    }
    return next;
  });
}

export function runMaterialVarianceClose(input: RunProductionWorkflowInput): ProductionWorkflowResult {
  const generatedAt = new Date().toISOString();
  if (!input.workbooks.length) {
    return {
      taskCode: TASK_CODE,
      generatedAt,
      blocked: true,
      clarifications: [{ id: 'need_files', message: '请上传 BOM/标准用量、实际产量、领料等文件' }],
      exceptions: [],
      summary: {},
      tables: {},
    };
  }

  let lines = computeLines(input.workbooks);
  lines = applyActions(lines, input.actions ?? []);
  const ignored = new Set(
    (input.actions ?? []).filter((a) => a.action === 'ignore_once' || a.action === 'confirm').map((a) => a.materialCode),
  );
  let exceptions = buildExceptions(lines).filter((e) => !ignored.has(e.materialCode));

  const pendingReturnList = lines.filter((l) => l.issued > l.theoreticalUsage && l.returned === 0 && l.variance > 0);

  const varianceRows = lines.map((l) => ({
    物料编码: l.materialCode,
    物料名称: l.materialName,
    产品编码: l.productCode,
    产品名称: l.productName,
    合格产量: l.goodOutput,
    标准用量: l.standardUsage,
    理论消耗: l.theoreticalUsage,
    领料数量: l.issued,
    退料数量: l.returned,
    实际消耗: l.actualUsage,
    消耗差异: l.variance,
    差异率: Math.round(l.varianceRate * 10000) / 10000,
    来源文件: l.sourceFile,
    原始行号: l.sourceRow,
  }));

  const excessRows = lines
    .filter((l) => l.variance > 1e-9)
    .map((l) => ({
      物料编码: l.materialCode,
      物料名称: l.materialName,
      超耗数量: l.variance,
      差异率: Math.round(l.varianceRate * 10000) / 10000,
      核实状态: (input.actions ?? []).some((a) => a.materialCode === l.materialCode && a.action === 'confirm')
        ? '已确认'
        : '待核实',
      来源文件: l.sourceFile,
      原始行号: l.sourceRow,
    }));

  const abnormalIssue = lines
    .filter((l) => l.issued > l.theoreticalUsage * 1.5 && l.theoreticalUsage > 0)
    .map((l) => ({
      物料编码: l.materialCode,
      物料名称: l.materialName,
      领料数量: l.issued,
      理论消耗: l.theoreticalUsage,
      异常原因: '领料明显高于理论消耗',
      来源文件: l.sourceFile,
      原始行号: l.sourceRow,
    }));

  const returnList = pendingReturnList.map((l) => ({
    物料编码: l.materialCode,
    物料名称: l.materialName,
    建议退料数量: Math.round(Math.max(0, l.issued - l.theoreticalUsage - l.scrap) * 1000) / 1000,
    原因: '领用多于理论消耗且未退料',
    来源文件: l.sourceFile,
    原始行号: l.sourceRow,
  }));

  const manualRows = exceptions.map((e) => ({
    异常类型: e.code,
    物料编码: e.materialCode || '-',
    物料名称: e.materialName || '-',
    异常原因: e.message,
    相关数量: e.value ?? '',
    人工确认状态: '待确认',
  }));

  return {
    taskCode: TASK_CODE,
    generatedAt,
    blocked: false,
    clarifications: [],
    exceptions,
    summary: {
      lineCount: lines.length,
      excessCount: excessRows.length,
      abnormalIssueCount: abnormalIssue.length,
      pendingReturnCount: returnList.length,
      exceptionCount: exceptions.length,
      totalVariance: Math.round(lines.reduce((s, l) => s + l.variance, 0) * 1000) / 1000,
      processedRecordCount: lines.length,
      autoClosedCount: Math.max(0, lines.length - exceptions.length),
      manualConfirmCount: exceptions.length,
    },
    tables: {
      variance: varianceRows,
      excess: excessRows,
      abnormalIssue,
      pendingReturn: returnList,
      manual: manualRows,
    },
    appliedActions: input.actions,
    aiPayload: {
      taskCode: TASK_CODE,
      metrics: { lineCount: lines.length, excessCount: excessRows.length },
      sampleExceptions: exceptions.slice(0, 20).map((e) => ({ code: e.code, message: e.message })),
      note: '数量由本地规则计算。禁止上传完整生产表。',
    },
  };
}

export function buildMaterialVarianceDeliverables(result: ProductionWorkflowResult): ProductionDeliverable[] {
  const day = dayStamp(result.generatedAt);
  return [
    {
      kind: 'variance',
      fileName: `物料消耗差异_${day}.xlsx`,
      bytes: writeBusinessWorkbook(result.tables.variance ?? [], '物料消耗差异'),
    },
    {
      kind: 'excess',
      fileName: `超耗核实单_${day}.xlsx`,
      bytes: writeBusinessWorkbook(result.tables.excess ?? [], '超耗核实单'),
    },
    {
      kind: 'abnormal_issue',
      fileName: `异常领料单_${day}.xlsx`,
      bytes: writeBusinessWorkbook(result.tables.abnormalIssue ?? [], '异常领料单'),
    },
    {
      kind: 'pending_return',
      fileName: `待退料清单_${day}.xlsx`,
      bytes: writeBusinessWorkbook(result.tables.pendingReturn ?? [], '待退料清单'),
    },
    {
      kind: 'manual',
      fileName: `人工确认清单_${day}.xlsx`,
      bytes: writeBusinessWorkbook(result.tables.manual ?? [], '人工确认清单'),
    },
  ];
}

export function exceptionKey(exc: ProductionException): string {
  return [exc.code, exc.materialCode ?? '', exc.message].join('|');
}
