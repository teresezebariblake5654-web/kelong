import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { calculatePareto, groupTrace } from '../operators/calculatePareto.js';
import { detectDuplicateRecords } from '../operators/detectDuplicateRecords.js';
import {
  evaluateExpectedValue,
  evaluateQualityLimit,
  type QualityResultType,
} from '../operators/evaluateQuality.js';
import { asText, parseNumeric, type FieldAliasMap } from '../operators/fieldUtils.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import { toQualityRules } from '../rules/RuleStore.js';
import { createTraceId } from '../SourceTrace.js';
import type { OperatorContext } from '../types.js';

const INSPECTION_ALIASES: FieldAliasMap = {
  inspectionNo: ['检验单号', '检验编号', 'inspection_no', '检验号'],
  inspectionDate: ['检验日期', '日期', 'date', 'inspection_date'],
  productCode: ['产品编码', '成品编码', '物料编码', 'product_code'],
  lotNo: ['批次号', '批号', 'lot', 'lot_no'],
  workOrderNo: ['工单号', '生产订单', 'work_order'],
  inspectionItem: ['检验项目', '项目', 'item', 'inspection_item'],
  result: ['结果', '检验结果', '实测值', 'result'],
  checkedQty: ['检验数量', '抽检数量', 'checked_qty'],
  failedQty: ['不合格数', '不良数', 'failed_qty'],
  defectType: ['缺陷类型', '不良类型', 'defect_type'],
  defectLevel: ['缺陷等级', '严重度', 'defect_level'],
  inspector: ['检验员', 'inspector'],
  standardVersion: ['标准版本', '版本', 'standard_version'],
};

const STANDARD_ALIASES: FieldAliasMap = {
  productCode: ['产品编码', '成品编码', 'product_code'],
  inspectionItem: ['检验项目', '项目', 'item', 'inspection_item'],
  resultType: ['结果类型', '类型', 'result_type'],
  lowerLimit: ['下限', '下规格', 'lower_limit', 'LSL'],
  upperLimit: ['上限', '上规格', 'upper_limit', 'USL'],
  expectedValue: ['期望值', '标准值', 'expected_value'],
  standardVersion: ['标准版本', '版本', 'standard_version'],
  criticalFlag: ['致命', '关键', 'critical', 'critical_flag'],
};

type QualityResultStatus =
  | 'PASS'
  | 'FAIL'
  | 'CRITICAL_DEFECT'
  | 'HIGH_FAIL_RATE'
  | 'MISSING_STANDARD'
  | 'STANDARD_VERSION_MISMATCH'
  | 'DUPLICATE_INSPECTION'
  | 'INVALID_RESULT'
  | 'QUARANTINE_RECOMMENDED';

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function summarize(ctx: OperatorContext) {
  const counts = new Map<
    string,
    { code: string; severity: 'INFO' | 'WARNING' | 'BLOCKING'; count: number; message?: string }
  >();
  for (const item of ctx.exceptions) {
    const prev = counts.get(item.code);
    if (prev) prev.count += 1;
    else counts.set(item.code, { code: item.code, severity: item.severity, count: 1, message: item.message });
  }
  return [...counts.values()];
}

function parseResultType(raw: unknown): QualityResultType {
  const text = asText(raw).toUpperCase();
  if (text === 'BOOLEAN' || text === 'BOOL') return 'BOOLEAN';
  if (text === 'ENUM' || text === 'TEXT') return 'ENUM';
  return 'NUMERIC';
}

/**
 * Thin orchestrator for PROD-QUALITY-005.
 * Never auto-releases failed lots.
 */
export async function executeProdQuality(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  const inspectionDs = ctx.datasets.get('inspection');
  const standardDs = ctx.datasets.get('quality_standard');
  if (!inspectionDs || !standardDs) {
    throw new Error('inspection and quality_standard are required');
  }

  const rules = toQualityRules(ctx.companyRules);

  const inspections: DataRow[] = normalizeColumns(inspectionDs.rows, INSPECTION_ALIASES, {
    role: 'inspection',
    sourceFile: inspectionDs.fileName,
    sourceSheet: inspectionDs.sheetName,
    inputSha256: inspectionDs.sha256,
  }).map((row) => {
    const date = normalizeDate(row.inspectionDate);
    return {
      ...row,
      inspectionDate: date.ok ? date.value : row.inspectionDate,
      _dateOk: date.ok,
    };
  });

  const standards: DataRow[] = normalizeColumns(standardDs.rows, STANDARD_ALIASES, {
    role: 'quality_standard',
    sourceFile: standardDs.fileName,
    sourceSheet: standardDs.sheetName,
    inputSha256: standardDs.sha256,
  });

  const standardMap = new Map<string, DataRow[]>();
  for (const row of standards) {
    const key = `${asText(row.productCode).toLowerCase()}||${asText(row.inspectionItem).toLowerCase()}`;
    const list = standardMap.get(key) ?? [];
    list.push(row);
    standardMap.set(key, list);
  }

  const dup = detectDuplicateRecords(inspections, {
    keyFields: ['inspectionNo', 'productCode', 'lotNo', 'inspectionItem'],
    strategy: rules.duplicateInspectionStrategy,
    dateField: 'inspectionDate',
  });

  const duplicateSheet = dup.duplicates.map((row) => ({
    inspectionNo: row.inspectionNo,
    productCode: row.productCode,
    lotNo: row.lotNo,
    inspectionItem: row.inspectionItem,
    inspectionDate: row.inspectionDate,
    resultStatus: 'DUPLICATE_INSPECTION',
    reason: '重复检验记录',
    sourceTrace: traceOf(row),
    selectedSourceTrace: row.selectedSourceTrace ?? '',
  }));

  if (dup.blockedGroups.length > 0 || (rules.duplicateInspectionStrategy === 'BLOCK' && dup.duplicates.length > 0)) {
    for (const row of dup.duplicates) {
      ctx.exceptions.push({
        code: 'DUPLICATE_INSPECTION',
        severity: 'BLOCKING',
        message: `重复检验 ${asText(row.inspectionNo)}`,
      });
    }
  }

  const workRows =
    rules.duplicateInspectionStrategy === 'BLOCK'
      ? inspections.filter(
          (row) =>
            !dup.duplicates.some(
              (dupRow) =>
                asText(dupRow.inspectionNo) === asText(row.inspectionNo) &&
                asText(dupRow.inspectionItem) === asText(row.inspectionItem) &&
                asText(dupRow.lotNo) === asText(row.lotNo),
            ),
        )
      : dup.unique;

  // If BLOCK strategy, still evaluate all but mark duplicates; better: exclude blocked from pass evaluation
  const evaluateList =
    rules.duplicateInspectionStrategy === 'BLOCK' && dup.duplicates.length > 0
      ? inspections
      : workRows;

  const overview: DataRow[] = [];
  const missingStandard: DataRow[] = [];
  const quarantine: DataRow[] = [];

  for (const row of evaluateList) {
    const tags: QualityResultStatus[] = [];
    let passFlag: boolean | '' = '';
    let reason = '';
    let normalizedResult: string | number | '' = '';
    let lowerLimit: unknown = '';
    let upperLimit: unknown = '';
    let expectedValue: unknown = '';
    let standardVersion = '';

    const isDup = dup.duplicates.some(
      (item) =>
        asText(item.inspectionNo) === asText(row.inspectionNo) &&
        asText(item.lotNo) === asText(row.lotNo) &&
        asText(item.inspectionItem) === asText(row.inspectionItem) &&
        asText(item._sourceRow) === asText(row._sourceRow),
    );
    if (isDup && rules.duplicateInspectionStrategy === 'BLOCK') {
      tags.push('DUPLICATE_INSPECTION');
    }

    if (
      hasBlank(row.inspectionNo) ||
      hasBlank(row.productCode) ||
      hasBlank(row.lotNo) ||
      hasBlank(row.inspectionItem) ||
      row.result === undefined ||
      row.result === null ||
      asText(row.result) === ''
    ) {
      tags.push('INVALID_RESULT');
      reason = '关键字段缺失或结果无效';
    }

    const key = `${asText(row.productCode).toLowerCase()}||${asText(row.inspectionItem).toLowerCase()}`;
    const matchedStandards = standardMap.get(key) ?? [];
    let standard: DataRow | undefined = matchedStandards[0];

    if (matchedStandards.length === 0) {
      tags.push('MISSING_STANDARD');
      reason = '缺少检验标准';
      if (rules.missingStandardBlocksRelease) tags.push('QUARANTINE_RECOMMENDED');
      missingStandard.push({
        productCode: row.productCode,
        inspectionItem: row.inspectionItem,
        lotNo: row.lotNo,
        inspectionNo: row.inspectionNo,
        reason: '缺少检验标准',
        sourceTrace: traceOf(row),
      });
    } else {
      if (asText(row.standardVersion)) {
        standard = matchedStandards.find(
          (item) => asText(item.standardVersion) === asText(row.standardVersion),
        );
        if (!standard) {
          tags.push('STANDARD_VERSION_MISMATCH');
          reason = '标准版本不一致';
          standard = matchedStandards[0];
        }
      }
      if (standard) {
        lowerLimit = standard.lowerLimit ?? '';
        upperLimit = standard.upperLimit ?? '';
        expectedValue = standard.expectedValue ?? '';
        standardVersion = asText(standard.standardVersion);
        const resultType = parseResultType(standard.resultType);
        if (resultType === 'NUMERIC') {
          const evaluated = evaluateQualityLimit({
            result: row.result,
            lowerLimit: standard.lowerLimit,
            upperLimit: standard.upperLimit,
          });
          passFlag = evaluated.passFlag;
          normalizedResult = evaluated.normalizedResult ?? '';
          reason = evaluated.reason;
          if (evaluated.normalizedResult === null) tags.push('INVALID_RESULT');
        } else {
          const evaluated = evaluateExpectedValue({
            result: row.result,
            expectedValue: standard.expectedValue,
            resultType,
          });
          passFlag = evaluated.passFlag;
          normalizedResult = evaluated.normalizedResult;
          reason = evaluated.reason;
        }
        if (passFlag === false) tags.push('FAIL');
        if (passFlag === true && tags.length === 0) tags.push('PASS');

        const defectLevel = asText(row.defectLevel);
        const defectType = asText(row.defectType);
        const criticalByFlag =
          asText(standard.criticalFlag).toLowerCase() === 'true' ||
          standard.criticalFlag === true ||
          asText(standard.criticalFlag) === '1' ||
          asText(standard.criticalFlag) === '是';
        const criticalByRule =
          rules.criticalDefects.some(
            (item) => item.toLowerCase() === defectType.toLowerCase(),
          ) || defectLevel.toLowerCase().includes('critical') || defectLevel.includes('致命');
        if ((passFlag === false && (criticalByFlag || criticalByRule)) || criticalByRule) {
          tags.push('CRITICAL_DEFECT');
          tags.push('QUARANTINE_RECOMMENDED');
        }
      }
    }

    if (passFlag === false) tags.push('QUARANTINE_RECOMMENDED');

    const primary =
      ([
        'INVALID_RESULT',
        'DUPLICATE_INSPECTION',
        'MISSING_STANDARD',
        'STANDARD_VERSION_MISMATCH',
        'CRITICAL_DEFECT',
        'QUARANTINE_RECOMMENDED',
        'HIGH_FAIL_RATE',
        'FAIL',
        'PASS',
      ] as QualityResultStatus[]).find((status) => tags.includes(status)) ?? 'PASS';

    const out: DataRow = {
      inspectionNo: row.inspectionNo,
      productCode: row.productCode,
      lotNo: row.lotNo,
      workOrderNo: row.workOrderNo,
      inspectionItem: row.inspectionItem,
      originalResult: row.result,
      normalizedResult,
      lowerLimit,
      upperLimit,
      expectedValue,
      passFlag,
      defectType: row.defectType ?? '',
      defectLevel: row.defectLevel ?? '',
      resultStatus: primary,
      statusTags: [...new Set(tags)].join('|'),
      reason,
      standardVersion,
      checkedQty: row.checkedQty ?? '',
      failedQty: row.failedQty ?? '',
      sourceTrace: traceOf(row),
      sourceFile: row._sourceFile,
      sourceSheet: row._sourceSheet,
      sourceRow: row._sourceRow,
      workflowVersion: ctx.workflowVersion,
      inputSha256: [inspectionDs.sha256, standardDs.sha256].join('|'),
      traceId: createTraceId('qa'),
    };
    overview.push(out);

    if (
      tags.includes('QUARANTINE_RECOMMENDED') ||
      tags.includes('CRITICAL_DEFECT') ||
      tags.includes('FAIL') ||
      tags.includes('MISSING_STANDARD')
    ) {
      quarantine.push({
        ...out,
        suggestedAction: '隔离待处置，禁止自动放行',
      });
    }

    for (const tag of ['CRITICAL_DEFECT', 'MISSING_STANDARD', 'STANDARD_VERSION_MISMATCH', 'DUPLICATE_INSPECTION', 'QUARANTINE_RECOMMENDED'] as const) {
      if (tags.includes(tag)) {
        ctx.exceptions.push({ code: tag, severity: 'BLOCKING', message: `${tag} ${asText(row.lotNo)}` });
      }
    }
  }

  // Lot fail-rate using explicit checkedQty/failedQty when present, else record counts.
  const lotGroups = groupTrace(overview, ['productCode', 'lotNo']);
  for (const group of lotGroups) {
    const withQty = group.rows.filter(
      (row) => parseNumeric(row.checkedQty) !== null || parseNumeric(row.failedQty) !== null,
    );
    let checkedQty = 0;
    let failedQty = 0;
    if (withQty.length > 0) {
      checkedQty = withQty.reduce((sum, row) => sum + (parseNumeric(row.checkedQty) ?? 0), 0);
      failedQty = withQty.reduce((sum, row) => sum + (parseNumeric(row.failedQty) ?? 0), 0);
    } else {
      checkedQty = group.rows.length;
      failedQty = group.rows.filter((row) => row.passFlag === false).length;
    }
    const failRate = failedQty / Math.max(checkedQty, 1);
    if (failRate > rules.failRateThreshold && checkedQty > 0) {
      for (const row of group.rows) {
        row.statusTags = `${asText(row.statusTags)}|HIGH_FAIL_RATE`;
        if (asText(row.resultStatus) === 'PASS' || asText(row.resultStatus) === 'FAIL') {
          row.resultStatus = 'HIGH_FAIL_RATE';
        }
        if (!quarantine.some((item) => item.traceId === row.traceId)) {
          quarantine.push({
            ...row,
            resultStatus: 'HIGH_FAIL_RATE',
            reason: '批次不良率超限',
            suggestedAction: '隔离待处置，禁止自动放行',
          });
        }
        ctx.exceptions.push({
          code: 'HIGH_FAIL_RATE',
          severity: 'BLOCKING',
          message: '批次不良率超限',
        });
      }
    }
  }

  const failedForPareto = overview
    .filter((row) => row.passFlag === false || asText(row.defectType))
    .map((row) => ({
      defectType: asText(row.defectType) || 'UNKNOWN',
      failedQty: parseNumeric(row.failedQty) ?? (row.passFlag === false ? 1 : 0),
    }));
  const pareto = calculatePareto(failedForPareto, {
    threshold: rules.paretoThreshold,
  });

  const lotTrace = lotGroups.map((group) => ({
    productCode: group.rows[0]?.productCode,
    lotNo: group.rows[0]?.lotNo,
    workOrderNo: group.rows[0]?.workOrderNo,
    inspectionCount: group.count,
    failCount: group.rows.filter((row) => row.passFlag === false).length,
    statuses: [...new Set(group.rows.map((row) => asText(row.resultStatus)))].join('|'),
    sourceTrace: group.rows.map((row) => asText(row.sourceTrace)).join('; '),
  }));

  const runNotes: DataRow[] = [
    { key: 'workflowId', value: definition.id },
    { key: 'workflowVersion', value: ctx.workflowVersion },
    { key: 'runDate', value: ctx.runDate },
    { key: 'companyRules', value: JSON.stringify(rules) },
    { key: 'input.inspection.fileName', value: inspectionDs.fileName },
    { key: 'input.inspection.sha256', value: inspectionDs.sha256 },
    { key: 'input.quality_standard.fileName', value: standardDs.fileName },
    { key: 'input.quality_standard.sha256', value: standardDs.sha256 },
    { key: 'inspectionCount', value: overview.length },
    { key: 'failCount', value: overview.filter((row) => row.passFlag === false).length },
    { key: 'quarantineCount', value: quarantine.length },
    { key: 'missingStandardCount', value: missingStandard.length },
    { key: 'duplicateCount', value: duplicateSheet.length },
    { key: 'autoRelease', value: false },
    { key: 'cloudUpload', value: false },
    { key: 'aiSummaryPayload.rawRows', value: false },
  ];

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '质量异常处理_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '质量总览', rows: overview },
      { name: '隔离清单', rows: quarantine },
      { name: '缺陷Pareto', rows: pareto },
      { name: '批次追溯', rows: lotTrace },
      { name: '缺标准', rows: missingStandard },
      { name: '重复检验', rows: duplicateSheet },
      { name: '运行说明', rows: runNotes },
    ],
  });

  const lotCount = lotGroups.length;
  const failedLotCount = lotGroups.filter((group) =>
    group.rows.some((row) => row.passFlag === false || asText(row.resultStatus).includes('FAIL')),
  ).length;
  const defectTypeCounts = pareto.reduce<Record<string, number>>((acc, row) => {
    acc[row.defectType] = row.defectQty;
    return acc;
  }, {});

  const needsReview = overview.some((row) =>
    [
      'CRITICAL_DEFECT',
      'MISSING_STANDARD',
      'STANDARD_VERSION_MISMATCH',
      'DUPLICATE_INSPECTION',
      'QUARANTINE_RECOMMENDED',
      'HIGH_FAIL_RATE',
    ].includes(asText(row.resultStatus)),
  );

  ctx.metrics = {
    inspectionCount: overview.length,
    failCount: overview.filter((row) => row.passFlag === false).length,
    lotCount,
    failedLotCount,
    criticalCount: overview.filter((row) => asText(row.statusTags).includes('CRITICAL_DEFECT')).length,
    missingStandardCount: missingStandard.length,
    localExecution: true,
    uploadedRawWorkbook: false,
  };

  return {
    runId: ctx.runId,
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    status: needsReview ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath],
    metrics: ctx.metrics,
    exceptions: summarize(ctx),
    aiSummaryPayload: {
      workflowId: definition.id,
      workflowVersion: ctx.workflowVersion,
      runId: ctx.runId,
      rawRows: false,
      metrics: {
        inspectionCount: overview.length,
        failCount: overview.filter((row) => row.passFlag === false).length,
        lotCount,
        failedLotCount,
        criticalCount: Number(ctx.metrics.criticalCount),
        missingStandardCount: missingStandard.length,
        defectTypeCounts,
        failRateBucket:
          overview.length === 0
            ? 'none'
            : overview.filter((row) => row.passFlag === false).length / overview.length > 0.1
              ? 'high'
              : 'low',
      },
      note: 'No lot/work order/product/inspector/raw values.',
    },
  };
}
