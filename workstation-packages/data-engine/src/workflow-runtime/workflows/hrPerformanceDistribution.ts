import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  detectDuplicateKeys,
} from '../operators/hrCommon.js';
import { moneyToFixed, toDecimal } from '../operators/money.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import {
  toPerformanceRules,
  type PerformanceRatingBand,
  type PerformanceRules,
} from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const PERF_ALIASES: FieldAliasMap = {
  employeeId: ['工号', '员工编号', '员工号', 'employee_id', 'empId'],
  employeeName: ['姓名', '员工姓名', 'employee_name', 'name'],
  department: ['部门', 'dept', 'department'],
  level: ['职级', '级别', 'level', 'grade'],
  score: ['分数', '得分', 'score', '绩效分'],
  rating: ['评级', '等级', 'rating', '绩效等级'],
  cycle: ['周期', '考核周期', 'cycle', 'period'],
};
const DIST_ALIASES: FieldAliasMap = {
  groupKey: ['分组', '组别', 'group_key', 'group'],
  rating: ['评级', '等级', 'rating'],
  targetMinRate: ['下限比例', '最小比例', 'target_min_rate', 'minRate'],
  targetMaxRate: ['上限比例', '最大比例', 'target_max_rate', 'maxRate'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function expectedRating(score: number, bands: PerformanceRatingBand[]): string {
  for (const band of bands) {
    if (score >= band.minScore && score <= band.maxScore) return band.rating;
  }
  return '';
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function iqrBounds(values: number[]): { low: number; high: number } | null {
  if (values.length < 4) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = median(sorted.slice(0, Math.floor(sorted.length / 2)));
  const q3 = median(sorted.slice(Math.ceil(sorted.length / 2)));
  const iqr = q3 - q1;
  return { low: q1 - 1.5 * iqr, high: q3 + 1.5 * iqr };
}

function groupKeyOf(row: DataRow, groupBy: string[]): string {
  return groupBy.map((f) => asText(row[f]) || '(空白)').join('|');
}

function normRole(ctx: OperatorContext, role: string, aliases: FieldAliasMap): DataRow[] {
  const ds = ctx.datasets.get(role);
  if (!ds) return [];
  return normalizeColumns(ds.rows, aliases, {
    role,
    sourceFile: ds.fileName,
    sourceSheet: ds.sheetName,
    inputSha256: ds.sha256,
  });
}

/**
 * Thin orchestrator for HR-PERFORMANCE-DISTRIBUTION-007.
 * Never auto-corrects scores/ratings — suggestions only.
 */
export async function executeHrPerformanceDistribution(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('performance')) {
    throw new Error('performance is required');
  }

  const rules: PerformanceRules = toPerformanceRules(ctx.companyRules);
  const cycle = String(ctx.companyRules.cycle ?? ctx.runDate.slice(0, 7));
  const rows = normRole(ctx, 'performance', PERF_ALIASES);
  const distRules = normRole(ctx, 'distribution_rule', DIST_ALIASES);

  const exceptionRows: DataRow[] = [];
  const dataIssues: DataRow[] = [];
  const note = (
    employeeId: string,
    code: string,
    severity: 'INFO' | 'WARNING' | 'BLOCKING',
    message: string,
    sourceTrace: string,
  ) => {
    ctx.exceptions.push({ code, severity, message, row: { employeeId } });
    exceptionRows.push({ employeeId, code, severity, message, sourceTrace });
    dataIssues.push({ employeeId, code, severity, message, sourceTrace });
  };

  const dups = detectDuplicateKeys(
    rows.filter((r) => asText(r.employeeId)),
    ['employeeId'],
  );
  const dupIds = new Set(dups.map((d) => d.key));

  const validated: DataRow[] = [];
  for (const row of rows) {
    const employeeId = asText(row.employeeId);
    const sourceTrace = traceOf(row);
    const scoreDec = toDecimal(row.score);
    const score = Number(scoreDec.toString());
    if (!employeeId || hasBlank(row.department) || hasBlank(row.level) || hasBlank(row.score) || hasBlank(row.rating)) {
      note(employeeId || '(blank)', 'MISSING_REQUIRED_FIELD', 'BLOCKING', '绩效必填缺失', sourceTrace);
    }
    if (employeeId && dupIds.has(employeeId.toLowerCase())) {
      note(employeeId, 'DUPLICATE_SCORE', 'BLOCKING', '员工重复评分', sourceTrace);
    }
    if (score < 0 || score > 100 || scoreDec.isNaN()) {
      note(employeeId, 'SCORE_OUT_OF_RANGE', 'BLOCKING', '评分越界', sourceTrace);
    }
    const expected = expectedRating(score, rules.ratingBands);
    const rating = asText(row.rating).toUpperCase();
    if (expected && rating && expected.toUpperCase() !== rating) {
      note(employeeId, 'RATING_SCORE_MISMATCH', 'WARNING', `评级与分数不匹配，建议 ${expected}`, sourceTrace);
    }
    validated.push({
      ...row,
      employeeId,
      score: moneyToFixed(scoreDec, 2),
      originalScore: moneyToFixed(scoreDec, 2),
      originalRating: row.rating,
      rating,
      expectedRating: expected,
      sourceTrace,
      // NEVER auto-correct — keep originals
    });
  }

  const byGroup = new Map<string, DataRow[]>();
  for (const row of validated) {
    const key = groupKeyOf(row, rules.groupBy);
    byGroup.set(key, [...(byGroup.get(key) ?? []), row]);
  }

  const distribution: DataRow[] = [];
  const deptLevel: DataRow[] = [];
  const suggestions: DataRow[] = [];
  const outliers: DataRow[] = [];

  for (const [group, list] of [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const scores = list.map((r) => Number(r.score));
    const avg = mean(scores);
    const med = median(scores);
    const sd = stdDev(scores);
    const ratingCounts = new Map<string, number>();
    for (const row of list) {
      const rating = asText(row.rating) || '(空白)';
      ratingCounts.set(rating, (ratingCounts.get(rating) ?? 0) + 1);
    }

    for (const [rating, count] of ratingCounts) {
      distribution.push({
        groupKey: group,
        rating,
        count,
        rate: Number((count / list.length).toFixed(4)),
        groupSize: list.length,
      });
    }

    deptLevel.push({
      groupKey: group,
      employeeCount: list.length,
      meanScore: Number(avg.toFixed(2)),
      medianScore: Number(med.toFixed(2)),
      stdDev: Number(sd.toFixed(2)),
    });

    const smallGroup = list.length < rules.minimumGroupSize;
    if (smallGroup) {
      suggestions.push({
        groupKey: group,
        suggestionType: 'SMALL_GROUP_NO_FORCE',
        message: `分组人数 ${list.length} < ${rules.minimumGroupSize}，不强制分布，仅校准建议`,
        autoCorrect: false,
      });
    }

    // target band checks
    const applicable = distRules.filter(
      (r) => asText(r.groupKey) === group || asText(r.groupKey) === '*' || !asText(r.groupKey),
    );
    for (const rule of applicable) {
      const rating = asText(rule.rating).toUpperCase();
      const count = ratingCounts.get(rating) ?? ratingCounts.get(asText(rule.rating)) ?? 0;
      const rate = list.length === 0 ? 0 : count / list.length;
      const minRate = Number(rule.targetMinRate ?? 0);
      const maxRate = Number(rule.targetMaxRate ?? 1);
      if (!smallGroup && (rate < minRate || rate > maxRate)) {
        suggestions.push({
          groupKey: group,
          rating,
          actualRate: Number(rate.toFixed(4)),
          targetMinRate: minRate,
          targetMaxRate: maxRate,
          suggestionType: 'DISTRIBUTION_BAND',
          message: `评级 ${rating} 占比 ${rate.toFixed(4)} 超出目标区间，建议人工校准（不改原始分）`,
          autoCorrect: false,
        });
        ctx.exceptions.push({
          code: 'DISTRIBUTION_OUT_OF_BAND',
          severity: 'WARNING',
          message: `分布超规则: ${group}/${rating}`,
          row: { groupKey: group },
        });
        exceptionRows.push({
          employeeId: '',
          code: 'DISTRIBUTION_OUT_OF_BAND',
          severity: 'WARNING',
          message: `分布超规则: ${group}/${rating}`,
          sourceTrace: '',
        });
      } else if (smallGroup && (rate < minRate || rate > maxRate)) {
        suggestions.push({
          groupKey: group,
          rating,
          actualRate: Number(rate.toFixed(4)),
          targetMinRate: minRate,
          targetMaxRate: maxRate,
          suggestionType: 'SMALL_GROUP_BAND_HINT',
          message: '小样本仅提示，不强制分布',
          autoCorrect: false,
        });
      }
    }

    const bounds =
      rules.outlierMethod === 'ZSCORE'
        ? null
        : iqrBounds(scores);
    for (const row of list) {
      const score = Number(row.score);
      let isOutlier = false;
      let method = rules.outlierMethod;
      let detail = '';
      if (rules.outlierMethod === 'ZSCORE' && sd > 0) {
        const z = (score - avg) / sd;
        if (Math.abs(z) >= rules.outlierZScore) {
          isOutlier = true;
          detail = `z=${z.toFixed(2)}`;
        }
      } else if (bounds && (score < bounds.low || score > bounds.high)) {
        isOutlier = true;
        detail = `iqr=[${bounds.low.toFixed(2)},${bounds.high.toFixed(2)}]`;
      }
      if (isOutlier) {
        outliers.push({
          employeeId: row.employeeId,
          groupKey: group,
          originalScore: row.originalScore,
          originalRating: row.originalRating,
          method,
          detail,
          suggestion: '人工复核，系统不修改分数/评级',
          sourceTrace: row.sourceTrace,
        });
        ctx.exceptions.push({
          code: 'OUTLIER',
          severity: 'INFO',
          message: '离群人员',
          row: { employeeId: row.employeeId },
        });
      }
    }
  }

  // Ensure mismatch suggestions keep originals
  for (const row of validated) {
    if (asText(row.expectedRating) && asText(row.expectedRating).toUpperCase() !== asText(row.rating)) {
      suggestions.push({
        employeeId: row.employeeId,
        groupKey: groupKeyOf(row, rules.groupBy),
        originalScore: row.originalScore,
        originalRating: row.originalRating,
        suggestedRating: row.expectedRating,
        suggestionType: 'RATING_ALIGNMENT',
        message: '建议人工核对评级，输出保留原始值',
        autoCorrect: false,
        sourceTrace: row.sourceTrace,
      });
    }
  }

  const runNotes = buildHrRunNotes({
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    runDate: ctx.runDate,
    rules: rules as unknown as Record<string, unknown>,
    inputSha256ByRole: ctx.inputSha256ByRole,
    inputRowCount: rows.length,
    outputRowCount: validated.length,
    exceptionCount: exceptionRows.length,
    extras: [
      { key: 'cycle', value: cycle },
      { key: 'autoCorrectScores', value: false },
      {
        key: 'overallMean',
        value: Number(mean(validated.map((r) => Number(r.score))).toFixed(2)),
      },
      {
        key: 'overallMedian',
        value: Number(median(validated.map((r) => Number(r.score))).toFixed(2)),
      },
    ],
  });

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '绩效分布与校准_{cycle}.xlsx',
    { cycle, runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '绩效分布', rows: distribution },
      { name: '部门职级分析', rows: deptLevel },
      { name: '校准建议', rows: suggestions },
      { name: '离群人员', rows: outliers },
      { name: '数据异常', rows: dataIssues },
      { name: '运行说明', rows: runNotes },
    ],
  });

  ctx.metrics = {
    employeeCount: validated.length,
    groupCount: byGroup.size,
    suggestionCount: suggestions.length,
    outlierCount: outliers.length,
    exceptionCount: exceptionRows.length,
    autoCorrectScores: false,
    localExecution: true,
    cloudUpload: false,
    uploadedRawWorkbook: false,
  };

  return {
    runId: ctx.runId,
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    status: exceptionRows.length > 0 ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath],
    metrics: ctx.metrics,
    exceptions: aggregateExceptionCounts(ctx.exceptions),
    aiSummaryPayload: {
      workflowId: definition.id,
      workflowVersion: ctx.workflowVersion,
      runId: ctx.runId,
      rawRows: false,
      containsPii: false,
      metrics: {
        employeeCount: validated.length,
        groupCount: byGroup.size,
        suggestionCount: suggestions.length,
        outlierCount: outliers.length,
        exceptionCount: exceptionRows.length,
        autoCorrectScores: false,
        overallMean: Number(mean(validated.map((r) => Number(r.score))).toFixed(2)),
        overallMedian: Number(median(validated.map((r) => Number(r.score))).toFixed(2)),
        exceptionByCode: aggregateExceptionCounts(ctx.exceptions).map((e) => ({
          code: e.code,
          count: e.count,
          severity: e.severity,
        })),
      },
      note: 'Aggregates only; suggestions never overwrite scores/ratings.',
    },
  };
}
