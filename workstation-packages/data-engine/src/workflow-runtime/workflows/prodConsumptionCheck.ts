import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { aggregateRows } from '../operators/aggregate.js';
import { classifyRows, filterRows, type ExceptionClass } from '../operators/classify.js';
import { deriveRows } from '../operators/derive.js';
import { asText, parseNumeric, roundQty, type FieldAliasMap } from '../operators/fieldUtils.js';
import { joinRows } from '../operators/join.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeSignedQuantityRows } from '../operators/normalizeSignedQuantity.js';
import { toConsumptionRules } from '../rules/RuleStore.js';
import { createTraceId } from '../SourceTrace.js';
import type { OperatorContext } from '../types.js';

const BOM_ALIASES: FieldAliasMap = {
  productCode: ['产品编码', '成品编码', '产品料号', 'product_code', '产品代码'],
  materialCode: ['物料编码', '料号', '子件编码', 'material_code', '物料号'],
  materialName: ['物料名称', '品名', '子件名称', 'material_name'],
  unitUsage: ['单位耗用', '单位用量', '用量', 'unit_usage', '定额'],
  lossRate: ['损耗率', '损耗', 'loss_rate', '损耗比例'],
  bomVersion: ['BOM版本', '版本', 'bom_version', '版次'],
  unit: ['单位', '计量单位', 'unit'],
  isSubstitute: ['替代料', '是否替代', 'substitute'],
};

const OUTPUT_ALIASES: FieldAliasMap = {
  workOrderNo: ['工单号', '生产订单', '工单', 'work_order', 'WO'],
  productCode: ['产品编码', '成品编码', '产品料号', 'product_code', '产品代码'],
  goodQty: ['合格产量', '良品数', '完工数量', 'good_qty', '产量'],
  reportDate: ['报工日期', '日期', 'report_date'],
  unit: ['单位', '计量单位', 'unit'],
};

const ISSUE_ALIASES: FieldAliasMap = {
  workOrderNo: ['工单号', '生产订单', '工单', 'work_order', 'WO'],
  materialCode: ['物料编码', '料号', 'material_code', '物料号'],
  materialName: ['物料名称', '品名', 'material_name'],
  movementType: ['类型', '出入库类型', '业务类型', '移动类型', 'movement_type'],
  qty: ['数量', 'qty', 'quantity'],
  unit: ['单位', '计量单位', 'unit'],
  transactionDate: ['日期', '业务日期', 'transaction_date'],
};

function parseLossRate(value: unknown, fallback: number): number {
  if (value === null || value === undefined || asText(value) === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1 ? value / 100 : value;
  }
  const text = asText(value).replace(/%/g, '');
  const num = Number(text);
  if (!Number.isFinite(num)) return fallback;
  return num > 1 ? num / 100 : num;
}

function summarizeExceptions(ctx: OperatorContext) {
  const counts = new Map<string, { code: string; severity: 'INFO' | 'WARNING' | 'BLOCKING'; count: number; message?: string }>();
  for (const item of ctx.exceptions) {
    const prev = counts.get(item.code);
    if (prev) prev.count += 1;
    else counts.set(item.code, { code: item.code, severity: item.severity, count: 1, message: item.message });
  }
  return [...counts.values()];
}

function pushException(
  ctx: OperatorContext,
  code: ExceptionClass | string,
  severity: 'INFO' | 'WARNING' | 'BLOCKING',
  message: string,
  row?: DataRow,
) {
  ctx.exceptions.push({ code, severity, message, row });
}

/**
 * Thin orchestrator: load config → reusable operators → inject consumption rules → sheets.
 * Join / aggregate / derive / classify live in shared operators, not here.
 */
export async function executeProdConsumptionCheck(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  const bomDs = ctx.datasets.get('bom');
  const outputDs = ctx.datasets.get('production_output');
  const issueDs = ctx.datasets.get('material_issue');
  if (!bomDs || !outputDs || !issueDs) {
    throw new Error('bom, production_output and material_issue are required');
  }

  const rules = toConsumptionRules(ctx.companyRules);
  const executedAt = new Date().toISOString();

  // --- normalize columns (aliases) ---
  const bomRows = normalizeColumns(bomDs.rows, BOM_ALIASES, {
    role: 'bom',
    sourceFile: bomDs.fileName,
    sourceSheet: bomDs.sheetName,
    inputSha256: bomDs.sha256,
  });
  const outputRows = normalizeColumns(outputDs.rows, OUTPUT_ALIASES, {
    role: 'production_output',
    sourceFile: outputDs.fileName,
    sourceSheet: outputDs.sheetName,
    inputSha256: outputDs.sha256,
  });
  const issueRaw = normalizeColumns(issueDs.rows, ISSUE_ALIASES, {
    role: 'material_issue',
    sourceFile: issueDs.fileName,
    sourceSheet: issueDs.sheetName,
    inputSha256: issueDs.sha256,
  });

  // --- invalid data scans ---
  for (const row of bomRows) {
    if (hasBlank(row.productCode) || hasBlank(row.materialCode)) {
      pushException(ctx, 'INVALID_DATA', 'BLOCKING', 'BOM 产品/物料编码为空', row);
    }
    if (parseNumeric(row.unitUsage) === null && !hasBlank(row.unitUsage)) {
      pushException(ctx, 'INVALID_DATA', 'BLOCKING', 'BOM 单位耗用无法转数字', row);
    }
  }
  for (const row of outputRows) {
    if (hasBlank(row.workOrderNo)) pushException(ctx, 'INVALID_DATA', 'BLOCKING', '工单号为空', row);
    if (hasBlank(row.productCode)) pushException(ctx, 'INVALID_DATA', 'BLOCKING', '产品编码为空', row);
    if (parseNumeric(row.goodQty) === null && !hasBlank(row.goodQty)) {
      pushException(ctx, 'INVALID_DATA', 'BLOCKING', '合格产量无法转数字', row);
    }
  }
  for (const row of issueRaw) {
    if (hasBlank(row.workOrderNo)) pushException(ctx, 'INVALID_DATA', 'BLOCKING', '领退料工单号为空', row);
    if (hasBlank(row.materialCode)) pushException(ctx, 'INVALID_DATA', 'BLOCKING', '领退料物料编码为空', row);
    if (parseNumeric(row.qty) === null && !hasBlank(row.qty)) {
      pushException(ctx, 'INVALID_DATA', 'BLOCKING', '领退料数量无法转数字', row);
    }
  }

  // --- duplicate BOM detection (same product+material, ambiguous version) ---
  const bomGroups = new Map<string, DataRow[]>();
  for (const row of bomRows) {
    const key = `${asText(row.productCode).toLowerCase()}||${asText(row.materialCode).toLowerCase()}`;
    const list = bomGroups.get(key) ?? [];
    list.push(row);
    bomGroups.set(key, list);
  }
  const duplicateBomKeys = new Set<string>();
  for (const [key, list] of bomGroups) {
    if (list.length <= 1) continue;
    const versions = new Set(list.map((row) => asText(row.bomVersion) || ''));
    if (versions.size > 1 || versions.has('')) {
      duplicateBomKeys.add(key);
      pushException(ctx, 'DUPLICATE_BOM', 'BLOCKING', `BOM 重复且版本不明确: ${key}`);
    }
  }

  // Prefer first BOM line per product+material for expansion.
  const bomUnique = [...bomGroups.values()].map((list) => list[0]!);

  // Products in BOM with no production output → MISSING_OUTPUT
  const productsWithOutput = new Set(
    outputRows.map((row) => asText(row.productCode).toLowerCase()).filter(Boolean),
  );
  const missingOutputRows: DataRow[] = [];
  for (const row of bomUnique) {
    const productCode = asText(row.productCode);
    if (productCode && !productsWithOutput.has(productCode.toLowerCase())) {
      missingOutputRows.push({
        ...row,
        status: 'MISSING_OUTPUT',
        reason: 'BOM 存在，但工单无合格产量',
      });
      pushException(ctx, 'MISSING_OUTPUT', 'WARNING', `BOM 产品无产量: ${productCode}`);
    }
  }

  // --- signed quantity + aggregate actual by workOrderNo+materialCode ---
  const signedIssues = normalizeSignedQuantityRows(issueRaw, {
    typeField: 'movementType',
    qtyField: 'qty',
  });
  const actualAgg = deriveRows(
    aggregateRows(signedIssues, {
      groupBy: ['workOrderNo', 'materialCode'],
      metrics: {
        issueQty: { field: 'issueQty', op: 'sum' },
        returnQty: { field: 'returnQty', op: 'sum' },
        materialName: { field: 'materialName', op: 'first' },
        unit: { field: 'unit', op: 'first' },
        _sourceFile: { field: '_sourceFile', op: 'first' },
        _sourceSheet: { field: '_sourceSheet', op: 'first' },
        _sourceRow: { field: '_sourceRow', op: 'first' },
        _inputSha256: { field: '_inputSha256', op: 'first' },
      },
    }),
    {
      actualQty: 'issueQty - returnQty',
    },
  );

  // --- expand standard: production_output ⋈ bom on productCode (left) ---
  const expanded = joinRows({
    left: outputRows,
    right: bomUnique,
    keys: ['productCode'],
    joinType: 'left',
  });

  const standardLines = deriveRows(
    expanded.map((row) => {
      const lossRate = parseLossRate(row.lossRate, rules.defaultLossRate);
      const unitUsage = parseNumeric(row.unitUsage);
      const goodQty = parseNumeric(row.goodQty) ?? 0;
      const bomMaterial = asText(row.materialCode);
      return {
        ...row,
        lossRate,
        unitUsage: unitUsage ?? 0,
        goodQty,
        _hasBomMaterial: Boolean(bomMaterial),
        materialCode: bomMaterial || asText(row.materialCode),
        materialName: asText(row.materialName),
        bomUnit: asText(row.unit),
      };
    }),
    {
      standardQty: 'goodQty * unitUsage * (1 + lossRate)',
    },
  );

  // Outputs with no BOM material matched → MISSING_BOM
  for (const row of standardLines) {
    if (!row._hasBomMaterial) {
      pushException(
        ctx,
        'MISSING_BOM',
        'BLOCKING',
        `工单产品找不到 BOM: ${asText(row.workOrderNo)}/${asText(row.productCode)}`,
        row,
      );
    }
  }

  const standardAgg = aggregateRows(
    filterRows(standardLines, (row) => Boolean(row._hasBomMaterial)),
    {
      groupBy: ['workOrderNo', 'materialCode'],
      metrics: {
        productCode: { field: 'productCode', op: 'first' },
        materialName: { field: 'materialName', op: 'first' },
        goodQty: { field: 'goodQty', op: 'first' },
        unitUsage: { field: 'unitUsage', op: 'first' },
        lossRate: { field: 'lossRate', op: 'first' },
        standardQty: { field: 'standardQty', op: 'sum' },
        bomUnit: { field: 'bomUnit', op: 'first' },
        _sourceFile: { field: '_sourceFile', op: 'first' },
        _sourceSheet: { field: '_sourceSheet', op: 'first' },
        _sourceRow: { field: '_sourceRow', op: 'first' },
        _inputSha256: { field: '_inputSha256', op: 'first' },
      },
    },
  );

  // --- full join standard vs actual (must not be inner) ---
  const joined = joinRows({
    left: standardAgg,
    right: actualAgg,
    keys: ['workOrderNo', 'materialCode'],
    joinType: 'full',
  });

  const computed = deriveRows(
    joined.map((row) => {
      const standardQty = parseNumeric(row.standardQty) ?? 0;
      const issueQty = parseNumeric(row.issueQty) ?? 0;
      const returnQty = parseNumeric(row.returnQty) ?? 0;
      const actualQty =
        parseNumeric(row.actualQty) ?? roundQty(issueQty - returnQty);
      const hasStandard = row.standardQty !== null && row.standardQty !== undefined && asText(row.productCode) !== '';
      // Detect presence: standard side has productCode from BOM expand; actual-only lacks unitUsage from standard
      const fromStandard = row.unitUsage !== undefined && row.unitUsage !== null && asText(String(row.unitUsage)) !== '';
      const fromActual = issueQty !== 0 || returnQty !== 0 || row.actualQty !== undefined;
      const actualOnly = fromActual && !fromStandard;
      const standardOnly = fromStandard && !fromActual;
      const bomUnit = asText(row.bomUnit ?? row.unit);
      const actualUnit = asText(row.unit);
      const unitMismatch =
        Boolean(bomUnit) && Boolean(actualUnit) && bomUnit.toUpperCase() !== actualUnit.toUpperCase();

      return {
        ...row,
        goodQty: parseNumeric(row.goodQty) ?? '',
        unitUsage: parseNumeric(row.unitUsage) ?? '',
        lossRate: parseNumeric(row.lossRate) ?? '',
        standardQty: fromStandard ? standardQty : '',
        issueQty,
        returnQty,
        actualQty: fromActual || fromStandard ? actualQty : '',
        _fromStandard: fromStandard,
        _fromActual: fromActual,
        _actualOnly: actualOnly,
        _standardOnly: standardOnly,
        _hasStandard: hasStandard,
        _unitMismatch: unitMismatch,
        unit: actualUnit || bomUnit,
      };
    }),
    {
      varianceQty: (row) => {
        if (row._actualOnly || row.standardQty === '') return '';
        const actual = parseNumeric(row.actualQty) ?? 0;
        const standard = parseNumeric(row.standardQty) ?? 0;
        return roundQty(actual - standard);
      },
      varianceRate: (row) => {
        const variance = parseNumeric(row.varianceQty);
        const standard = parseNumeric(row.standardQty);
        if (variance === null || standard === null) return '';
        return roundQty(variance / Math.max(Math.abs(standard), 1), 8);
      },
    },
  );

  const classified = classifyRows(computed, [
    {
      code: 'INVALID_DATA',
      severity: 'BLOCKING',
      when: (row) => hasBlank(row.workOrderNo) || hasBlank(row.materialCode),
      reason: '关键字段缺失',
    },
    {
      code: 'DUPLICATE_BOM',
      severity: 'BLOCKING',
      when: (row) =>
        duplicateBomKeys.has(
          `${asText(row.productCode).toLowerCase()}||${asText(row.materialCode).toLowerCase()}`,
        ),
      reason: 'BOM 重复且版本不明确',
    },
    {
      code: 'SUBSTITUTE_NOT_ALLOWED',
      severity: 'BLOCKING',
      when: (row) => Boolean(row._actualOnly) && !rules.allowSubstituteMaterial,
      reason: '替代料存在但公司规则不允许',
    },
    {
      code: 'WRONG_MATERIAL',
      severity: 'BLOCKING',
      when: (row) => Boolean(row._actualOnly),
      reason: '实际领用了 BOM 中不存在的物料',
    },
    {
      code: 'MISSING_BOM',
      severity: 'BLOCKING',
      when: (row) => Boolean(row._fromStandard) === false && Boolean(row._fromActual) === false,
      reason: '工单产品找不到 BOM',
    },
    {
      code: 'MISSING_ACTUAL_USAGE',
      severity: 'WARNING',
      when: (row) => Boolean(row._standardOnly),
      reason: 'BOM 要求物料但实际耗用缺失',
    },
    {
      code: 'NEGATIVE_USAGE',
      severity: 'BLOCKING',
      when: (row) => {
        const actual = parseNumeric(row.actualQty);
        return actual !== null && actual < 0;
      },
      reason: '实际耗用为负',
    },
    {
      code: 'INVALID_DATA',
      severity: 'WARNING',
      when: (row) => {
        const standard = parseNumeric(row.standardQty) ?? 0;
        const actual = parseNumeric(row.actualQty) ?? 0;
        return standard === 0 && actual !== 0 && Boolean(row._fromStandard);
      },
      reason: '标准耗用为零但存在实际耗用',
    },
    {
      code: 'UNIT_MISMATCH',
      severity: 'BLOCKING',
      when: (row) => Boolean(row._unitMismatch),
      reason: '单位不一致',
    },
    {
      code: 'OVERUSE',
      severity: 'WARNING',
      when: (row) => {
        const rate = parseNumeric(row.varianceRate);
        return rate !== null && rate > rules.overuseToleranceRate;
      },
      reason: '超耗率超过容差',
    },
    {
      code: 'UNDERUSE',
      severity: 'WARNING',
      when: (row) => {
        const rate = parseNumeric(row.varianceRate);
        return rate !== null && rate < -rules.underuseToleranceRate;
      },
      reason: '少耗率超过容差',
    },
    {
      code: 'NORMAL',
      severity: 'INFO',
      when: () => true,
      reason: '正常',
    },
  ]);

  // Re-push row-level exceptions from classification for summary counts
  for (const row of classified) {
    const status = asText(row.status);
    if (!status || status === 'NORMAL') continue;
    const severity =
      status === 'OVERUSE' ||
      status === 'UNDERUSE' ||
      status === 'MISSING_ACTUAL_USAGE' ||
      status === 'MISSING_OUTPUT'
        ? 'WARNING'
        : 'BLOCKING';
    // Avoid double-counting duplicates already pushed; still OK for metrics via classify statuses
    if (
      status === 'WRONG_MATERIAL' ||
      status === 'MISSING_ACTUAL_USAGE' ||
      status === 'OVERUSE' ||
      status === 'UNDERUSE' ||
      status === 'NEGATIVE_USAGE' ||
      status === 'UNIT_MISMATCH' ||
      status === 'SUBSTITUTE_NOT_ALLOWED'
    ) {
      pushException(ctx, status, severity, asText(row.reason) || status, row);
    }
  }

  const resultRows: DataRow[] = classified.map((row) => {
    const sourceFile = [asText(row._sourceFile), issueDs.fileName].filter(Boolean).join('|');
    const sourceSheet = asText(row._sourceSheet) || issueDs.sheetName;
    const sourceRow = row._sourceRow ?? '';
    const inputSha256 = [
      ...new Set(
        [bomDs.sha256, outputDs.sha256, issueDs.sha256, asText(row._inputSha256)].filter(Boolean),
      ),
    ].join('|');
    return {
      workOrderNo: asText(row.workOrderNo),
      productCode: asText(row.productCode),
      materialCode: asText(row.materialCode),
      materialName: asText(row.materialName),
      goodQty: row.goodQty,
      unitUsage: row.unitUsage,
      lossRate: row.lossRate,
      standardQty: row.standardQty,
      issueQty: row.issueQty,
      returnQty: row.returnQty,
      actualQty: row.actualQty,
      varianceQty: row.varianceQty,
      varianceRate: row.varianceRate,
      status: row.status,
      reason: row.reason,
      sourceTrace: `${sourceFile}#${sourceSheet}:${sourceRow}`,
      sourceFile,
      sourceSheet,
      sourceRow,
      workflowVersion: ctx.workflowVersion,
      inputSha256,
      traceId: createTraceId('cc'),
    };
  });

  // Also add MISSING_BOM rows for outputs with no bom match (may not appear in join if filtered)
  for (const row of standardLines) {
    if (row._hasBomMaterial) continue;
    const exists = resultRows.some(
      (item) =>
        asText(item.workOrderNo) === asText(row.workOrderNo) &&
        asText(item.productCode) === asText(row.productCode) &&
        item.status === 'MISSING_BOM',
    );
    if (exists) continue;
    resultRows.push({
      workOrderNo: asText(row.workOrderNo),
      productCode: asText(row.productCode),
      materialCode: '',
      materialName: '',
      goodQty: row.goodQty,
      unitUsage: '',
      lossRate: '',
      standardQty: '',
      issueQty: '',
      returnQty: '',
      actualQty: '',
      varianceQty: '',
      varianceRate: '',
      status: 'MISSING_BOM',
      reason: '工单产品找不到 BOM',
      sourceTrace: `${outputDs.fileName}#${outputDs.sheetName}:${row._sourceRow}`,
      sourceFile: outputDs.fileName,
      sourceSheet: outputDs.sheetName,
      sourceRow: row._sourceRow,
      workflowVersion: ctx.workflowVersion,
      inputSha256: outputDs.sha256,
      traceId: createTraceId('cc'),
    });
  }

  for (const row of missingOutputRows) {
    resultRows.push({
      workOrderNo: '',
      productCode: asText(row.productCode),
      materialCode: asText(row.materialCode),
      materialName: asText(row.materialName),
      goodQty: '',
      unitUsage: row.unitUsage,
      lossRate: row.lossRate,
      standardQty: '',
      issueQty: '',
      returnQty: '',
      actualQty: '',
      varianceQty: '',
      varianceRate: '',
      status: 'MISSING_OUTPUT',
      reason: asText(row.reason),
      sourceTrace: `${bomDs.fileName}#${bomDs.sheetName}:${row._sourceRow}`,
      sourceFile: bomDs.fileName,
      sourceSheet: bomDs.sheetName,
      sourceRow: row._sourceRow,
      workflowVersion: ctx.workflowVersion,
      inputSha256: bomDs.sha256,
      traceId: createTraceId('cc'),
    });
  }

  resultRows.sort((a, b) =>
    `${a.workOrderNo}|${a.materialCode}`.localeCompare(`${b.workOrderNo}|${b.materialCode}`, 'zh-CN'),
  );

  const overuse = filterRows(resultRows, (row) => asText(row.status) === 'OVERUSE');
  const underuse = filterRows(resultRows, (row) => asText(row.status) === 'UNDERUSE');
  const wrong = filterRows(
    resultRows,
    (row) =>
      asText(row.status) === 'WRONG_MATERIAL' ||
      asText(row.status) === 'SUBSTITUTE_NOT_ALLOWED',
  );
  const missing = filterRows(
    resultRows,
    (row) =>
      ['MISSING_BOM', 'MISSING_OUTPUT', 'MISSING_ACTUAL_USAGE', 'INVALID_DATA'].includes(
        asText(row.status),
      ),
  );
  const unitIssues = filterRows(resultRows, (row) => asText(row.status) === 'UNIT_MISMATCH');

  const runNotes: DataRow[] = [
    { key: 'workflowId', value: definition.id },
    { key: 'workflowVersion', value: ctx.workflowVersion },
    { key: 'executedAt', value: executedAt },
    { key: 'runDate', value: ctx.runDate },
    { key: 'companyRules', value: JSON.stringify(rules) },
    { key: 'input.bom.fileName', value: bomDs.fileName },
    { key: 'input.production_output.fileName', value: outputDs.fileName },
    { key: 'input.material_issue.fileName', value: issueDs.fileName },
    { key: 'input.bom.sha256', value: bomDs.sha256 },
    { key: 'input.production_output.sha256', value: outputDs.sha256 },
    { key: 'input.material_issue.sha256', value: issueDs.sha256 },
    { key: 'input.bom.rowCount', value: bomRows.length },
    { key: 'input.production_output.rowCount', value: outputRows.length },
    { key: 'input.material_issue.rowCount', value: issueRaw.length },
    { key: 'output.rowCount', value: resultRows.length },
    { key: 'exceptionCount', value: ctx.exceptions.length },
    { key: 'cloudUpload', value: false },
    { key: 'aiSummaryPayload.rawRows', value: false },
  ];

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '物料消耗核对_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  // User-required 7 sheets (extends catalog).
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '工单耗用核对', rows: resultRows },
      { name: '超耗清单', rows: overuse },
      { name: '少耗清单', rows: underuse },
      { name: '错料清单', rows: wrong },
      { name: '缺失清单', rows: missing },
      { name: '单位异常', rows: unitIssues },
      { name: '运行说明', rows: runNotes },
    ],
  });

  const reviewStatuses = new Set([
    'WRONG_MATERIAL',
    'MISSING_BOM',
    'UNIT_MISMATCH',
    'DUPLICATE_BOM',
    'SUBSTITUTE_NOT_ALLOWED',
    'INVALID_DATA',
    'NEGATIVE_USAGE',
  ]);
  const needsReview = resultRows.some((row) => reviewStatuses.has(asText(row.status))) ||
    duplicateBomKeys.size > 0;

  const statusCounts = resultRows.reduce<Record<string, number>>((acc, row) => {
    const status = asText(row.status) || 'NORMAL';
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});

  const standardTotal = resultRows.reduce(
    (sum, row) => sum + (parseNumeric(row.standardQty) ?? 0),
    0,
  );
  const actualTotal = resultRows.reduce(
    (sum, row) => sum + (parseNumeric(row.actualQty) ?? 0),
    0,
  );
  const varianceRates = resultRows
    .map((row) => parseNumeric(row.varianceRate))
    .filter((value): value is number => value !== null);
  const maxAbsVarianceRate =
    varianceRates.length === 0
      ? 0
      : Math.max(...varianceRates.map((value) => Math.abs(value)));

  const workOrderCount = new Set(resultRows.map((row) => asText(row.workOrderNo)).filter(Boolean)).size;
  const materialCount = new Set(resultRows.map((row) => asText(row.materialCode)).filter(Boolean)).size;

  ctx.metrics = {
    workOrderCount,
    materialCount,
    standardQtyTotal: roundQty(standardTotal),
    actualQtyTotal: roundQty(actualTotal),
    overuseCount: overuse.length,
    underuseCount: underuse.length,
    wrongMaterialCount: wrong.length,
    missingCount: missing.length,
    unitMismatchCount: unitIssues.length,
    outputRowCount: resultRows.length,
    localExecution: true,
    uploadedRawWorkbook: false,
  };

  const aiSummaryPayload = {
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    runId: ctx.runId,
    rawRows: false,
    metrics: {
      workOrderCount,
      materialCount,
      standardQtyTotal: roundQty(standardTotal),
      actualQtyTotal: roundQty(actualTotal),
      overuseCount: overuse.length,
      underuseCount: underuse.length,
      wrongMaterialCount: wrong.length,
      missingCount: missing.length,
      maxAbsVarianceRate: roundQty(maxAbsVarianceRate, 8),
      exceptionTypeCounts: statusCounts,
    },
    note: 'Desensitized aggregates only. No raw rows, paths, work orders, or material codes.',
  };

  return {
    runId: ctx.runId,
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    status: needsReview ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath],
    metrics: ctx.metrics,
    exceptions: summarizeExceptions(ctx),
    aiSummaryPayload,
  };
}
