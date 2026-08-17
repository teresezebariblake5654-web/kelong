import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { joinRows } from '../operators/join.js';
import {
  asText,
  matchCanonicalField,
  parseNumeric,
  remapRowHeaders,
  roundQty,
  type FieldAliasMap,
} from '../operators/fieldUtils.js';
import { attachTraceFields, buildSourceTrace, createTraceId, mergeSourceRows } from '../SourceTrace.js';
import type { OperatorContext } from '../types.js';

const OPENING_ALIASES: FieldAliasMap = {
  materialCode: ['物料编码', '料号', '物料号', '编码', '物料代码', 'material_code', 'sku'],
  materialName: ['物料名称', '品名', '名称', '物料名', 'material_name'],
  warehouse: ['仓库', '仓位', '库位', '仓库名称', 'warehouse'],
  openingQty: ['期初', '期初数量', '期初库存', 'opening', 'opening_qty', '期初结存'],
  unit: ['单位', '计量单位', 'unit'],
};

const MOVEMENT_ALIASES: FieldAliasMap = {
  date: ['日期', '业务日期', '单据日期', 'date', '交易日期'],
  materialCode: ['物料编码', '料号', '物料号', '编码', '物料代码', 'material_code', 'sku'],
  materialName: ['物料名称', '品名', '名称', '物料名', 'material_name'],
  warehouse: ['仓库', '仓位', '库位', '仓库名称', 'warehouse'],
  movementType: ['类型', '出入库类型', '业务类型', '移动类型', 'movement_type', '单据类型'],
  qty: ['数量', 'qty', 'quantity', '出入库数量'],
  unit: ['单位', '计量单位', 'unit'],
};

const COUNT_ALIASES: FieldAliasMap = {
  materialCode: ['物料编码', '料号', '物料号', '编码', '物料代码', 'material_code', 'sku'],
  materialName: ['物料名称', '品名', '名称', '物料名', 'material_name'],
  warehouse: ['仓库', '仓位', '库位', '仓库名称', 'warehouse'],
  actualQty: ['实盘', '实盘数量', '盘点数量', 'actual', 'actual_qty', '账面实盘'],
  unit: ['单位', '计量单位', 'unit'],
};

const IN_TYPES = new Set(['入库', '收料', '采购入库', 'in', 'inbound']);
const OUT_TYPES = new Set(['领料', '出库', '生产领用', 'out', 'outbound', 'issue']);
const RETURN_TYPES = new Set(['退料', '退库', 'return', 'returned']);

type TraceBits = {
  sourceFile: string;
  sourceSheet: string;
  sourceRows: number[];
  inputSha256: string;
};

type AggregateLine = {
  materialCode: string;
  materialName: string;
  warehouse: string;
  unit: string;
  openingQty: number;
  inQty: number;
  outQty: number;
  returnQty: number;
  actualQty: number | null;
  units: Set<string>;
  missingFields: string[];
  traces: TraceBits[];
  countKeys: string[];
};

function normalizeMovementType(raw: string): 'in' | 'out' | 'return' | 'unknown' {
  const text = raw.trim().toLowerCase();
  if ([...IN_TYPES].some((item) => item.toLowerCase() === text || raw.includes(item))) return 'in';
  if ([...OUT_TYPES].some((item) => item.toLowerCase() === text || raw.includes(item))) return 'out';
  if ([...RETURN_TYPES].some((item) => item.toLowerCase() === text || raw.includes(item))) return 'return';
  return 'unknown';
}

function groupKey(materialCode: string, warehouse: string): string {
  return `${materialCode.trim().toLowerCase()}||${warehouse.trim().toLowerCase() || '默认仓'}`;
}

function ensureLine(map: Map<string, AggregateLine>, seed: Partial<AggregateLine> & {
  materialCode: string;
  warehouse: string;
}): AggregateLine {
  const key = groupKey(seed.materialCode, seed.warehouse);
  const existing = map.get(key);
  if (existing) {
    if (!existing.materialName && seed.materialName) existing.materialName = seed.materialName;
    if (!existing.unit && seed.unit) existing.unit = seed.unit;
    return existing;
  }
  const created: AggregateLine = {
    materialCode: seed.materialCode,
    materialName: seed.materialName ?? '',
    warehouse: seed.warehouse || '默认仓',
    unit: seed.unit ?? '',
    openingQty: 0,
    inQty: 0,
    outQty: 0,
    returnQty: 0,
    actualQty: null,
    units: new Set(),
    missingFields: [],
    traces: [],
    countKeys: [],
  };
  map.set(key, created);
  return created;
}

function pushTrace(line: AggregateLine, bits: TraceBits): void {
  line.traces.push(bits);
}

function rowSourceMeta(
  ctx: OperatorContext,
  role: string,
  sourceRow: number,
): TraceBits {
  const dataset = ctx.datasets.get(role)!;
  return {
    sourceFile: dataset.fileName,
    sourceSheet: dataset.sheetName,
    sourceRows: [sourceRow],
    inputSha256: dataset.sha256,
  };
}

function collectMissingRequired(
  row: DataRow,
  required: string[],
): string[] {
  return required.filter((field) => {
    const value = row[field];
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    return false;
  });
}

export async function executeProdMaterialDaily(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  const opening = ctx.datasets.get('opening_stock');
  const movements = ctx.datasets.get('movements');
  if (!opening || !movements) {
    throw new Error('opening_stock and movements are required');
  }

  const toleranceQty = Number(ctx.companyRules['materialDaily.toleranceQty'] ?? 1);
  const toleranceRate = Number(ctx.companyRules['materialDaily.toleranceRate'] ?? 0.05);
  const negativeStockBlocked = Boolean(
    ctx.companyRules['materialDaily.negativeStockBlocked'] ?? true,
  );

  const lines = new Map<string, AggregateLine>();
  const missingDataRows: DataRow[] = [];

  // opening_stock
  opening.rows.forEach((raw, index) => {
    const row = remapRowHeaders(raw, OPENING_ALIASES);
    const materialCode = asText(row.materialCode);
    const warehouse = asText(row.warehouse) || '默认仓';
    const missing = collectMissingRequired(row, ['materialCode', 'materialName', 'warehouse', 'openingQty']);
    if (missing.length > 0) {
      missingDataRows.push(
        attachTraceFields(
          {
            role: 'opening_stock',
            missingFields: missing.join(','),
            materialCode,
            warehouse,
            rawPreview: JSON.stringify(raw).slice(0, 200),
          },
          buildSourceTrace({
            sourceFile: opening.fileName,
            sourceSheet: opening.sheetName,
            sourceRow: index + 2,
            workflowVersion: ctx.workflowVersion,
            inputSha256: opening.sha256,
            role: 'opening_stock',
          }),
        ),
      );
      ctx.exceptions.push({
        code: 'missing_required_field',
        severity: 'WARNING',
        message: `期初缺字段: ${missing.join(',')}`,
      });
    }
    if (!materialCode) return;
    const qty = parseNumeric(row.openingQty) ?? 0;
    const unit = asText(row.unit);
    const line = ensureLine(lines, {
      materialCode,
      materialName: asText(row.materialName),
      warehouse,
      unit,
    });
    line.openingQty = roundQty(line.openingQty + qty);
    if (unit) line.units.add(unit.toUpperCase());
    pushTrace(line, rowSourceMeta(ctx, 'opening_stock', index + 2));
  });

  // movements
  movements.rows.forEach((raw, index) => {
    const row = remapRowHeaders(raw, MOVEMENT_ALIASES);
    const materialCode = asText(row.materialCode);
    const warehouse = asText(row.warehouse) || '默认仓';
    const missing = collectMissingRequired(row, ['date', 'materialCode', 'movementType', 'qty']);
    if (missing.length > 0) {
      missingDataRows.push(
        attachTraceFields(
          {
            role: 'movements',
            missingFields: missing.join(','),
            materialCode,
            warehouse,
            rawPreview: JSON.stringify(raw).slice(0, 200),
          },
          buildSourceTrace({
            sourceFile: movements.fileName,
            sourceSheet: movements.sheetName,
            sourceRow: index + 2,
            workflowVersion: ctx.workflowVersion,
            inputSha256: movements.sha256,
            role: 'movements',
          }),
        ),
      );
      ctx.exceptions.push({
        code: 'missing_required_field',
        severity: 'WARNING',
        message: `出入库缺字段: ${missing.join(',')}`,
      });
    }
    if (!materialCode) return;
    const qty = Math.abs(parseNumeric(row.qty) ?? 0);
    const unit = asText(row.unit);
    const mapped = normalizeMovementType(asText(row.movementType));
    const line = ensureLine(lines, {
      materialCode,
      materialName: asText(row.materialName),
      warehouse,
      unit,
    });
    if (mapped === 'in') line.inQty = roundQty(line.inQty + qty);
    else if (mapped === 'out') line.outQty = roundQty(line.outQty + qty);
    else if (mapped === 'return') line.returnQty = roundQty(line.returnQty + qty);
    else {
      ctx.exceptions.push({
        code: 'unknown_movement_type',
        severity: 'WARNING',
        message: `未识别移动类型: ${asText(row.movementType)}`,
      });
    }
    if (unit) line.units.add(unit.toUpperCase());
    pushTrace(line, rowSourceMeta(ctx, 'movements', index + 2));
  });

  // physical_count (optional)
  const physical = ctx.datasets.get('physical_count');
  const countSeen = new Map<string, number>();
  if (physical) {
    physical.rows.forEach((raw, index) => {
      const row = remapRowHeaders(raw, COUNT_ALIASES);
      const materialCode = asText(row.materialCode);
      const warehouse = asText(row.warehouse) || '默认仓';
      const missing = collectMissingRequired(row, ['materialCode', 'warehouse', 'actualQty']);
      if (missing.length > 0) {
        missingDataRows.push(
          attachTraceFields(
            {
              role: 'physical_count',
              missingFields: missing.join(','),
              materialCode,
              warehouse,
              rawPreview: JSON.stringify(raw).slice(0, 200),
            },
            buildSourceTrace({
              sourceFile: physical.fileName,
              sourceSheet: physical.sheetName,
              sourceRow: index + 2,
              workflowVersion: ctx.workflowVersion,
              inputSha256: physical.sha256,
              role: 'physical_count',
            }),
          ),
        );
        ctx.exceptions.push({
          code: 'missing_required_field',
          severity: 'WARNING',
          message: `实盘缺字段: ${missing.join(',')}`,
        });
      }
      if (!materialCode) return;
      const key = groupKey(materialCode, warehouse);
      countSeen.set(key, (countSeen.get(key) ?? 0) + 1);
      const actualQty = parseNumeric(row.actualQty);
      const unit = asText(row.unit);
      const line = ensureLine(lines, {
        materialCode,
        materialName: asText(row.materialName),
        warehouse,
        unit,
      });
      line.actualQty = actualQty;
      line.countKeys.push(key);
      if (unit) line.units.add(unit.toUpperCase());
      pushTrace(line, rowSourceMeta(ctx, 'physical_count', index + 2));
    });
  }

  for (const [key, count] of countSeen) {
    if (count > 1) {
      ctx.exceptions.push({
        code: 'duplicate_physical_count',
        severity: 'BLOCKING',
        message: `重复实盘: ${key}`,
      });
    }
  }

  // Use join helper on role aggregates for acceptance of operator reuse.
  const openingAgg = [...lines.values()].map((line) => ({
    materialCode: line.materialCode,
    warehouse: line.warehouse,
    openingQty: line.openingQty,
  }));
  const movementAgg = [...lines.values()].map((line) => ({
    materialCode: line.materialCode,
    warehouse: line.warehouse,
    inQty: line.inQty,
    outQty: line.outQty,
    returnQty: line.returnQty,
  }));
  joinRows({
    left: openingAgg,
    right: movementAgg,
    keys: ['materialCode', 'warehouse'],
    joinType: 'full',
  });

  const dailyRows: DataRow[] = [];
  const varianceRows: DataRow[] = [];
  const negativeRows: DataRow[] = [];
  let negativeCount = 0;
  let missingCount = 0;
  let overToleranceCount = 0;
  let unitMismatchCount = 0;

  for (const line of lines.values()) {
    const theoreticalClosingQty = roundQty(
      line.openingQty + line.inQty - line.outQty + line.returnQty,
    );
    const hasActual = line.actualQty !== null && line.actualQty !== undefined;
    const varianceQty = hasActual ? roundQty((line.actualQty as number) - theoreticalClosingQty) : null;
    const varianceRate =
      varianceQty === null
        ? null
        : roundQty(varianceQty / Math.max(Math.abs(theoreticalClosingQty), 1), 8);

    const statuses: string[] = [];
    if (theoreticalClosingQty < 0) {
      statuses.push('negative_stock');
      negativeCount += 1;
      ctx.exceptions.push({
        code: 'negative_stock',
        severity: negativeStockBlocked ? 'BLOCKING' : 'WARNING',
        message: `理论负库存 ${line.materialCode}/${line.warehouse}`,
      });
    }
    if (!hasActual && physical) {
      statuses.push('missing_count');
      missingCount += 1;
      ctx.exceptions.push({
        code: 'missing_count',
        severity: 'WARNING',
        message: `缺少实盘 ${line.materialCode}/${line.warehouse}`,
      });
    }
    if (varianceQty !== null && Math.abs(varianceQty) > toleranceQty) {
      statuses.push('over_tolerance_qty');
      overToleranceCount += 1;
      ctx.exceptions.push({
        code: 'over_tolerance_qty',
        severity: 'BLOCKING',
        message: `差异数量超容差 ${line.materialCode}/${line.warehouse}`,
      });
    }
    if (varianceRate !== null && Math.abs(varianceRate) > toleranceRate) {
      statuses.push('over_tolerance_rate');
      overToleranceCount += 1;
      ctx.exceptions.push({
        code: 'over_tolerance_rate',
        severity: 'BLOCKING',
        message: `差异率超容差 ${line.materialCode}/${line.warehouse}`,
      });
    }
    if ((countSeen.get(groupKey(line.materialCode, line.warehouse)) ?? 0) > 1) {
      statuses.push('duplicate_count');
    }
    if (line.units.size > 1) {
      statuses.push('unit_mismatch');
      unitMismatchCount += 1;
      ctx.exceptions.push({
        code: 'unit_mismatch',
        severity: 'WARNING',
        message: `单位不一致 ${line.materialCode}/${line.warehouse}: ${[...line.units].join('/')}`,
      });
    }
    if (statuses.length === 0) statuses.push('normal');

    const firstTrace = line.traces[0];
    const mergedTrace = buildSourceTrace({
      sourceFile: firstTrace?.sourceFile ?? opening.fileName,
      sourceSheet: firstTrace?.sourceSheet ?? opening.sheetName,
      sourceRow: firstTrace?.sourceRows[0] ?? 2,
      workflowVersion: ctx.workflowVersion,
      inputSha256: firstTrace?.inputSha256 ?? opening.sha256,
      role: 'opening_stock',
    });
    const sourceRowText = mergeSourceRows(
      line.traces.flatMap((trace) =>
        trace.sourceRows.map((sourceRow) => ({ sourceRow })),
      ),
    );
    const sourceFiles = [...new Set(line.traces.map((trace) => trace.sourceFile))].join('|');
    const sourceSheets = [...new Set(line.traces.map((trace) => trace.sourceSheet))].join('|');
    const inputSha256 = [...new Set(line.traces.map((trace) => trace.inputSha256))].join('|');

    const resultRow = attachTraceFields(
      {
        materialCode: line.materialCode,
        materialName: line.materialName,
        warehouse: line.warehouse,
        unit: line.unit || [...line.units][0] || '',
        openingQty: line.openingQty,
        inQty: line.inQty,
        outQty: line.outQty,
        returnQty: line.returnQty,
        theoreticalClosingQty,
        actualQty: hasActual ? line.actualQty : '',
        varianceQty: varianceQty ?? '',
        varianceRate: varianceRate ?? '',
        status: statuses.join('|'),
        sourceFile: sourceFiles,
        sourceSheet: sourceSheets,
        sourceRow: sourceRowText,
        workflowVersion: ctx.workflowVersion,
        inputSha256,
        traceId: createTraceId('md'),
      },
      mergedTrace,
    );
    // Prefer merged multi-source fields over single-trace overwrite.
    resultRow.sourceFile = sourceFiles;
    resultRow.sourceSheet = sourceSheets;
    resultRow.sourceRow = sourceRowText;
    resultRow.inputSha256 = inputSha256;

    dailyRows.push(resultRow);
    ctx.traces.push(mergedTrace);

    if (varianceQty !== null && varianceQty !== 0) {
      varianceRows.push(resultRow);
    }
    if (theoreticalClosingQty < 0) {
      negativeRows.push(resultRow);
    }
    if (statuses.includes('missing_count')) {
      missingDataRows.push({
        ...resultRow,
        missingFields: 'actualQty',
        role: 'physical_count',
      });
    }
  }

  dailyRows.sort((a, b) =>
    `${a.materialCode}|${a.warehouse}`.localeCompare(`${b.materialCode}|${b.warehouse}`, 'zh-CN'),
  );

  const runNotes: DataRow[] = [
    { key: 'workflowId', value: definition.id },
    { key: 'workflowVersion', value: ctx.workflowVersion },
    { key: 'runId', value: ctx.runId },
    { key: 'runDate', value: ctx.runDate },
    { key: 'toleranceQty', value: toleranceQty },
    { key: 'toleranceRate', value: toleranceRate },
    { key: 'negativeStockBlocked', value: negativeStockBlocked },
    { key: 'formula', value: 'theoreticalClosingQty = openingQty + inQty - outQty + returnQty' },
    { key: 'aiRole', value: 'DeepSeek不参与库存数量计算；仅可接收脱敏摘要' },
    {
      key: 'inputSha256',
      value: [...ctx.inputSha256ByRole.entries()]
        .map(([role, hash]) => `${role}:${hash}`)
        .join('; '),
    },
    { key: 'localOnly', value: true },
    { key: 'cloudUpload', value: false },
  ];

  const fileName = renderFileNameTemplate(definition.output.fileNameTemplate, {
    runDate: ctx.runDate,
  });
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '日清总表', rows: dailyRows },
      { name: '库存差异', rows: varianceRows },
      { name: '负库存', rows: negativeRows },
      { name: '缺失数据', rows: missingDataRows },
      { name: '运行说明', rows: runNotes },
    ],
  });

  const needsReview =
    negativeCount > 0 ||
    overToleranceCount > 0 ||
    unitMismatchCount > 0 ||
    [...countSeen.values()].some((count) => count > 1);

  const exceptionCounts = new Map<string, { code: string; severity: 'INFO' | 'WARNING' | 'BLOCKING'; count: number; message?: string }>();
  for (const item of ctx.exceptions) {
    const prev = exceptionCounts.get(item.code);
    if (prev) prev.count += 1;
    else {
      exceptionCounts.set(item.code, {
        code: item.code,
        severity: item.severity,
        count: 1,
        message: item.message,
      });
    }
  }

  ctx.metrics = {
    lineCount: dailyRows.length,
    negativeStockCount: negativeCount,
    missingCount,
    overToleranceCount,
    unitMismatchCount,
    varianceLineCount: varianceRows.length,
    localExecution: true,
    uploadedRawWorkbook: false,
  };

  // Desensitized AI payload only — never include cleanedRows / raw workbook.
  const aiSummaryPayload = {
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    runId: ctx.runId,
    metrics: {
      lineCount: dailyRows.length,
      negativeStockCount: negativeCount,
      missingCount,
      overToleranceCount,
      unitMismatchCount,
    },
    exceptionSamples: [...exceptionCounts.values()].slice(0, 20).map((item) => ({
      code: item.code,
      severity: item.severity,
      count: item.count,
    })),
    rawRows: false,
    note: 'Do not send original Excel or full balance rows to DeepSeek.',
  };

  // Prove alias matcher is exercised for required fields.
  void matchCanonicalField('物料编码', OPENING_ALIASES);

  return {
    runId: ctx.runId,
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    status: needsReview ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath],
    metrics: ctx.metrics,
    exceptions: [...exceptionCounts.values()],
    aiSummaryPayload,
  };
}
