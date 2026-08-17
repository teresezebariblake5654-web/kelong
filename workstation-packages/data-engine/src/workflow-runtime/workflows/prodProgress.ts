import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { aggregateRows } from '../operators/aggregate.js';
import { aggregateTimeSeries } from '../operators/aggregateTimeSeries.js';
import { alignByExactKey } from '../operators/alignByExactKey.js';
import { daysBetween } from '../operators/dateWindow.js';
import { asText, parseNumeric, roundQty, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  buildWorkCalendar,
  forecastFinishDate,
} from '../operators/forecastFinishDate.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import {
  pickPrimaryStatus,
  type ProductionProgressStatus,
} from '../operators/normalizeProductionStatus.js';
import { toProductionProgressRules } from '../rules/RuleStore.js';
import { createTraceId } from '../SourceTrace.js';
import type { OperatorContext } from '../types.js';

const PLAN_ALIASES: FieldAliasMap = {
  workOrderNo: ['工单号', '生产订单', '工单', 'work_order', 'WO'],
  productCode: ['产品编码', '成品编码', '产品料号', 'product_code'],
  planQty: ['计划数量', '计划产量', '需求数量', 'plan_qty'],
  startDate: ['开始日期', '开工日期', '计划开始', 'start_date'],
  dueDate: ['交期', '完工日期', '计划完成', 'due_date'],
  planStatus: ['状态', '计划状态', 'plan_status'],
  lineCode: ['产线', '生产线', '线体', 'line_code'],
  standardUnitsPerHour: ['标准小时产量', '标准节拍', 'UPH', 'units_per_hour'],
  allowedOverproductionRate: ['超产率', '允许超产率'],
};

const REPORT_ALIASES: FieldAliasMap = {
  reportDate: ['报工日期', '日期', 'date', 'report_date'],
  workOrderNo: ['工单号', '生产订单', '工单', 'work_order', 'WO'],
  goodQty: ['合格产量', '良品数', '合格数', 'good_qty'],
  scrapQty: ['报废数量', '废品数', '报废', 'scrap_qty'],
  workHours: ['工时', '作业工时', 'work_hours'],
  lineCode: ['产线', '生产线', '线体', 'line_code'],
  reportStatus: ['报工状态', '状态', 'report_status'],
  delayReason: ['延期原因', '延误原因', 'delay_reason'],
};

const CALENDAR_ALIASES: FieldAliasMap = {
  date: ['日期', '日历日期', 'date'],
  isWorkday: ['是否工作日', '工作日', 'is_workday'],
  availableHours: ['可用工时', 'available_hours'],
};

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
    else {
      counts.set(item.code, {
        code: item.code,
        severity: item.severity,
        count: 1,
        message: item.message,
      });
    }
  }
  return [...counts.values()];
}

/**
 * Thin orchestrator for PROD-PROGRESS-004.
 */
export async function executeProdProgress(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  const planDs = ctx.datasets.get('plan');
  const reportDs = ctx.datasets.get('work_report');
  if (!planDs || !reportDs) throw new Error('plan and work_report are required');

  const rules = toProductionProgressRules(ctx.companyRules);
  const calendarDs = ctx.datasets.get('work_calendar');
  const calendarMode =
    calendarDs && rules.useWorkCalendar ? 'WORKDAY' : 'NATURAL_DAY';

  const planRows: DataRow[] = normalizeColumns(planDs.rows, PLAN_ALIASES, {
    role: 'plan',
    sourceFile: planDs.fileName,
    sourceSheet: planDs.sheetName,
    inputSha256: planDs.sha256,
  }).map((row) => {
    const start = normalizeDate(row.startDate);
    const due = normalizeDate(row.dueDate);
    return {
      ...row,
      startDate: start.ok ? start.value : row.startDate,
      dueDate: due.ok ? due.value : row.dueDate,
      _startOk: start.ok,
      _dueOk: due.ok,
      planQty: parseNumeric(row.planQty),
    };
  });

  const reportRows: DataRow[] = normalizeColumns(reportDs.rows, REPORT_ALIASES, {
    role: 'work_report',
    sourceFile: reportDs.fileName,
    sourceSheet: reportDs.sheetName,
    inputSha256: reportDs.sha256,
  }).map((row) => {
    const date = normalizeDate(row.reportDate);
    return {
      ...row,
      reportDate: date.ok ? date.value : row.reportDate,
      _dateOk: date.ok,
      goodQty: parseNumeric(row.goodQty) ?? 0,
      scrapQty: parseNumeric(row.scrapQty) ?? 0,
      workHours: parseNumeric(row.workHours) ?? 0,
    };
  });

  const calendar = calendarDs
    ? buildWorkCalendar(
        normalizeColumns(calendarDs.rows, CALENDAR_ALIASES, {
          role: 'work_calendar',
          sourceFile: calendarDs.fileName,
          sourceSheet: calendarDs.sheetName,
          inputSha256: calendarDs.sha256,
        }).map((row) => {
          const date = normalizeDate(row.date);
          return { ...row, date: date.ok ? date.value : row.date };
        }),
      )
    : [];

  // Daily series by workOrderNo + reportDate
  const daily = aggregateTimeSeries(reportRows.filter((row) => row._dateOk), {
    groupBy: ['workOrderNo', 'reportDate'],
    dateField: 'reportDate',
    metrics: {
      goodQty: { field: 'goodQty', op: 'sum' },
      scrapQty: { field: 'scrapQty', op: 'sum' },
      workHours: { field: 'workHours', op: 'sum' },
      lineCode: { field: 'lineCode', op: 'first' },
      _sourceFile: { field: '_sourceFile', op: 'first' },
      _sourceSheet: { field: '_sourceSheet', op: 'first' },
      _sourceRow: { field: '_sourceRow', op: 'first' },
      _inputSha256: { field: '_inputSha256', op: 'first' },
    },
    cumulativeFields: ['goodQty', 'scrapQty', 'workHours'],
  });

  const reportByWo = aggregateRows(reportRows, {
    groupBy: ['workOrderNo'],
    metrics: {
      cumulativeGoodQty: { field: 'goodQty', op: 'sum' },
      cumulativeScrapQty: { field: 'scrapQty', op: 'sum' },
      totalWorkHours: { field: 'workHours', op: 'sum' },
      lineCode: { field: 'lineCode', op: 'first' },
      _sourceFile: { field: '_sourceFile', op: 'first' },
      _sourceSheet: { field: '_sourceSheet', op: 'first' },
      _sourceRow: { field: '_sourceRow', op: 'first' },
      _inputSha256: { field: '_inputSha256', op: 'first' },
    },
  }).map((row) => {
    const dates = reportRows
      .filter((item) => asText(item.workOrderNo) === asText(row.workOrderNo) && item._dateOk)
      .map((item) => asText(item.reportDate))
      .filter(Boolean)
      .sort();
    return { ...row, lastReportDate: dates[dates.length - 1] ?? '' };
  });

  // Align plans to aggregated reports (exact workOrderNo). Multiple reports OK.
  const aligned = alignByExactKey(planRows, reportByWo, {
    keyField: 'workOrderNo',
    allowMultipleRight: true,
  });

  const progressRows: DataRow[] = [];
  const anomalyRows: DataRow[] = [];

  for (const conflict of aligned.leftConflicts) {
    anomalyRows.push({
      ...conflict,
      primaryStatus: 'PLAN_CONFLICT',
      statusTags: 'PLAN_CONFLICT',
      reason: '同工单存在多条计划',
      sourceTrace: traceOf(conflict),
    });
    ctx.exceptions.push({
      code: 'PLAN_CONFLICT',
      severity: 'BLOCKING',
      message: `计划冲突 ${asText(conflict.workOrderNo)}`,
    });
  }

  for (const row of aligned.rightOnly) {
    anomalyRows.push({
      workOrderNo: row.workOrderNo,
      productCode: '',
      cumulativeGoodQty: row.cumulativeGoodQty,
      cumulativeScrapQty: row.cumulativeScrapQty,
      primaryStatus: 'REPORT_WITHOUT_PLAN',
      statusTags: 'REPORT_WITHOUT_PLAN',
      reason: '报工无对应计划',
      sourceTrace: traceOf(row),
    });
    ctx.exceptions.push({
      code: 'REPORT_WITHOUT_PLAN',
      severity: 'BLOCKING',
      message: `报工无计划 ${asText(row.workOrderNo)}`,
    });
  }

  for (const item of aligned.matched) {
    const plan = item.left;
    const report = item.right;
    const tags: ProductionProgressStatus[] = [];

    const planQty = parseNumeric(plan.planQty);
    if (
      hasBlank(plan.workOrderNo) ||
      hasBlank(plan.productCode) ||
      planQty === null ||
      !plan._dueOk ||
      !plan._startOk
    ) {
      tags.push('INVALID_DATA');
    }

    const cumulativeGoodQty = parseNumeric(report?.cumulativeGoodQty) ?? 0;
    const cumulativeScrapQty = parseNumeric(report?.cumulativeScrapQty) ?? 0;
    const totalWorkHours = parseNumeric(report?.totalWorkHours) ?? 0;
    const completionRate =
      planQty === null ? null : roundQty(cumulativeGoodQty / Math.max(planQty, 1), 8);
    const scrapRate = roundQty(
      cumulativeScrapQty / Math.max(cumulativeGoodQty + cumulativeScrapQty, 1),
      8,
    );
    const avgHourlyOutput =
      totalWorkHours > 0 ? roundQty(cumulativeGoodQty / totalWorkHours, 8) : null;
    const remainingQty =
      planQty === null ? null : roundQty(Math.max(planQty - cumulativeGoodQty, 0));
    const estimatedRemainingHours =
      remainingQty === null || avgHourlyOutput === null || avgHourlyOutput <= 0
        ? null
        : roundQty(remainingQty / avgHourlyOutput, 6);

    const dueDate = asText(plan.dueDate);
    const daysToDue = dueDate ? daysBetween(ctx.runDate, dueDate) : null;
    const lastReportDate = asText(report?.lastReportDate);
    const noReportDays = lastReportDate
      ? daysBetween(lastReportDate, ctx.runDate)
      : plan._startOk
        ? daysBetween(asText(plan.startDate), ctx.runDate)
        : null;

    const estimatedFinishDate = forecastFinishDate({
      runDate: ctx.runDate,
      remainingHours: estimatedRemainingHours,
      calendarMode,
      defaultWorkdayHours: rules.defaultWorkdayHours,
      calendar,
    });

    const overRate =
      parseNumeric(plan.allowedOverproductionRate) ?? rules.allowedOverproductionRate;

    if (!report || cumulativeGoodQty <= 0) tags.push('NOT_STARTED');
    if (planQty !== null && cumulativeGoodQty >= planQty && remainingQty === 0) {
      tags.push('COMPLETED');
    }
    if (daysToDue !== null && daysToDue < 0 && (remainingQty ?? 0) > 0) tags.push('OVERDUE');
    if (
      daysToDue !== null &&
      daysToDue >= 0 &&
      daysToDue <= rules.delayWarningDays &&
      (remainingQty ?? 0) > 0
    ) {
      tags.push('DELAY_RISK');
    }
    if (estimatedFinishDate && dueDate && estimatedFinishDate > dueDate && (remainingQty ?? 0) > 0) {
      if (!tags.includes('OVERDUE')) tags.push('DELAY_RISK');
    }
    if (scrapRate > rules.maxScrapRate && cumulativeGoodQty + cumulativeScrapQty > 0) {
      tags.push('HIGH_SCRAP');
    }
    if (
      planQty !== null &&
      cumulativeGoodQty > planQty * (1 + overRate)
    ) {
      tags.push('OVERPRODUCTION');
    }
    if (
      (noReportDays ?? 0) >= rules.noReportWarningDays &&
      (remainingQty ?? 0) > 0
    ) {
      tags.push('NO_RECENT_REPORT');
    }
    if (
      tags.length === 0 ||
      (tags.length === 1 && tags[0] === 'NOT_STARTED' && cumulativeGoodQty > 0)
    ) {
      // fallthrough
    }
    if (
      !tags.includes('INVALID_DATA') &&
      !tags.includes('OVERDUE') &&
      !tags.includes('DELAY_RISK') &&
      !tags.includes('HIGH_SCRAP') &&
      !tags.includes('OVERPRODUCTION') &&
      !tags.includes('NO_RECENT_REPORT') &&
      !tags.includes('COMPLETED') &&
      cumulativeGoodQty > 0
    ) {
      tags.push('ON_TRACK');
    }
    if (tags.length === 0) tags.push('NOT_STARTED');

    const primaryStatus = pickPrimaryStatus(tags);
    const row: DataRow = {
      workOrderNo: plan.workOrderNo,
      productCode: plan.productCode,
      lineCode: plan.lineCode ?? report?.lineCode ?? '',
      planQty: planQty ?? '',
      cumulativeGoodQty,
      cumulativeScrapQty,
      completionRate: completionRate ?? '',
      scrapRate,
      totalWorkHours,
      avgHourlyOutput: avgHourlyOutput ?? '',
      remainingQty: remainingQty ?? '',
      estimatedRemainingHours: estimatedRemainingHours ?? '',
      estimatedFinishDate: estimatedFinishDate ?? '',
      dueDate,
      daysToDue: daysToDue ?? '',
      lastReportDate,
      noReportDays: noReportDays ?? '',
      primaryStatus,
      statusTags: [...new Set(tags)].join('|'),
      reason: primaryStatus,
      sourceTrace: traceOf(plan),
      sourceFile: plan._sourceFile,
      sourceSheet: plan._sourceSheet,
      sourceRow: plan._sourceRow,
      workflowVersion: ctx.workflowVersion,
      inputSha256: [planDs.sha256, reportDs.sha256].join('|'),
      traceId: createTraceId('pg'),
    };

    if (primaryStatus === 'INVALID_DATA' || primaryStatus === 'PLAN_CONFLICT') {
      anomalyRows.push(row);
      ctx.exceptions.push({
        code: primaryStatus,
        severity: 'BLOCKING',
        message: `${primaryStatus} ${asText(plan.workOrderNo)}`,
      });
    } else {
      progressRows.push(row);
      if (
        ['OVERDUE', 'DELAY_RISK', 'HIGH_SCRAP', 'OVERPRODUCTION', 'REPORT_WITHOUT_PLAN'].includes(
          primaryStatus,
        )
      ) {
        ctx.exceptions.push({
          code: primaryStatus,
          severity: primaryStatus === 'OVERDUE' ? 'BLOCKING' : 'WARNING',
          message: `${primaryStatus} ${asText(plan.workOrderNo)}`,
        });
      }
    }
  }

  progressRows.sort((a, b) =>
    asText(a.workOrderNo).localeCompare(asText(b.workOrderNo), 'en'),
  );

  const delayRows = progressRows.filter((row) =>
    ['DELAY_RISK', 'OVERDUE'].includes(asText(row.primaryStatus)),
  );
  const highScrap = progressRows.filter((row) =>
    asText(row.statusTags).includes('HIGH_SCRAP'),
  );

  const dailyOut = daily.map((row) => ({
    reportDate: row.reportDate,
    workOrderNo: row.workOrderNo,
    goodQty: row.goodQty,
    scrapQty: row.scrapQty,
    workHours: row.workHours,
    cumulative_goodQty: row.cumulative_goodQty,
    cumulative_scrapQty: row.cumulative_scrapQty,
    lineCode: row.lineCode ?? '',
    sourceTrace: traceOf(row),
    workflowVersion: ctx.workflowVersion,
    inputSha256: reportDs.sha256,
  }));

  const runNotes: DataRow[] = [
    { key: 'workflowId', value: definition.id },
    { key: 'workflowVersion', value: ctx.workflowVersion },
    { key: 'runDate', value: ctx.runDate },
    { key: 'companyId', value: ctx.request.companyId ?? '' },
    { key: 'companyRules', value: JSON.stringify(rules) },
    { key: 'calendarMode', value: calendarMode },
    {
      key: 'calendarNote',
      value:
        calendarMode === 'WORKDAY'
          ? '使用工作日历预计完工'
          : '未提供工作日历，使用自然日预计完工',
    },
    { key: 'input.plan.fileName', value: planDs.fileName },
    { key: 'input.plan.sha256', value: planDs.sha256 },
    { key: 'input.work_report.fileName', value: reportDs.fileName },
    { key: 'input.work_report.sha256', value: reportDs.sha256 },
    { key: 'input.plan.rowCount', value: planRows.length },
    { key: 'input.work_report.rowCount', value: reportRows.length },
    { key: 'progressRowCount', value: progressRows.length },
    { key: 'delayRiskCount', value: delayRows.length },
    { key: 'highScrapCount', value: highScrap.length },
    { key: 'anomalyCount', value: anomalyRows.length },
    { key: 'cloudUpload', value: false },
    { key: 'aiSummaryPayload.rawRows', value: false },
  ];

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '生产进度产量_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '工单进度', rows: progressRows },
      { name: '延期风险', rows: delayRows },
      { name: '产量日报', rows: dailyOut },
      { name: '高报废工单', rows: highScrap },
      { name: '数据异常', rows: anomalyRows },
      { name: '运行说明', rows: runNotes },
    ],
  });

  const needsReview =
    anomalyRows.length > 0 ||
    progressRows.some((row) =>
      ['OVERDUE', 'PLAN_CONFLICT', 'INVALID_DATA', 'REPORT_WITHOUT_PLAN'].includes(
        asText(row.primaryStatus),
      ),
    );

  const statusCounts = [...progressRows, ...anomalyRows].reduce<Record<string, number>>(
    (acc, row) => {
      const key = asText(row.primaryStatus) || 'UNKNOWN';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {},
  );

  ctx.metrics = {
    progressRowCount: progressRows.length,
    delayRiskCount: delayRows.length,
    highScrapCount: highScrap.length,
    anomalyCount: anomalyRows.length,
    calendarMode,
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
        progressRowCount: progressRows.length,
        delayRiskCount: delayRows.length,
        highScrapCount: highScrap.length,
        anomalyCount: anomalyRows.length,
        statusCounts,
        calendarMode,
      },
      note: 'Desensitized aggregates only. No work order or product codes.',
    },
  };
}
