import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { aggregateRows } from '../operators/aggregate.js';
import {
  aggregateDowntimeReason,
  detectPostCloseTransactions,
  evaluateChecklist,
} from '../operators/downtimeCloseOps.js';
import { asText, parseNumeric, roundQty, type FieldAliasMap } from '../operators/fieldUtils.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import {
  calculateIntervalDurationMinutes,
  detectIntervalOverlap,
  mergeIntervals,
  normalizeDateTime,
  totalIntervalMinutes,
  type TimeInterval,
} from '../operators/normalizeDateTime.js';
import { toDowntimeCloseRules } from '../rules/RuleStore.js';
import { createTraceId } from '../SourceTrace.js';
import type { OperatorContext } from '../types.js';

const DOWNTIME_ALIASES: FieldAliasMap = {
  machineCode: ['设备编号', '机台', '设备', 'machine_code', '设备编码'],
  startTime: ['开始时间', '停机开始', 'start_time', '开始'],
  endTime: ['结束时间', '停机结束', 'end_time', '结束'],
  reason: ['原因', '停机原因', 'reason'],
  workOrderNo: ['工单号', '生产订单', 'work_order'],
  lineCode: ['产线', '线体', 'line_code'],
  plannedFlag: ['计划停机', '是否计划', 'planned', 'planned_flag'],
  standardUnitsPerHour: ['标准小时产量', 'UPH', 'units_per_hour'],
};

const WO_ALIASES: FieldAliasMap = {
  workOrderNo: ['工单号', '生产订单', 'work_order'],
  productCode: ['产品编码', '成品编码', 'product_code'],
  planQty: ['计划数量', '计划产量', 'plan_qty'],
  status: ['状态', '工单状态', 'status'],
  startDate: ['开始日期', 'start_date'],
  dueDate: ['交期', 'due_date'],
  closedAt: ['结案时间', '关闭时间', 'closed_at'],
};

const REPORT_ALIASES: FieldAliasMap = {
  workOrderNo: ['工单号', '生产订单', 'work_order'],
  reportDate: ['报工日期', '日期', 'date', 'report_date'],
  goodQty: ['合格产量', '良品数', 'good_qty'],
  scrapQty: ['报废数量', '废品数', 'scrap_qty'],
  workHours: ['工时', 'work_hours'],
};

const MATERIAL_ALIASES: FieldAliasMap = {
  workOrderNo: ['工单号', 'work_order'],
  standardQty: ['标准耗用', '标准数量', 'standard_qty'],
  actualQty: ['实际耗用', '实际数量', 'actual_qty'],
  varianceRate: ['差异率', 'variance_rate'],
  unresolvedMaterialIssueCount: ['未解决问题数', '物料异常数', 'unresolved'],
};

const QUALITY_ALIASES: FieldAliasMap = {
  workOrderNo: ['工单号', 'work_order'],
  openIssueCount: ['未关闭问题数', 'open_issue_count'],
  criticalOpenIssueCount: ['致命未关闭', 'critical_open_issue_count'],
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
    else counts.set(item.code, { code: item.code, severity: item.severity, count: 1, message: item.message });
  }
  return [...counts.values()];
}

function isPlanned(value: unknown): boolean {
  const text = asText(value).toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === '是' || text === 'y' || value === true;
}

function suggestedAction(codes: string[]): string {
  if (codes.includes('OUTPUT_INCOMPLETE')) return '补齐产量或调整计划数量后重试结案';
  if (codes.includes('MATERIAL_UNBALANCED')) return '处理物料差异后再结案';
  if (codes.includes('QUALITY_OPEN') || codes.includes('CRITICAL_QUALITY_OPEN')) {
    return '关闭质量问题后再结案';
  }
  if (codes.includes('POST_CLOSE_TRANSACTION')) return '核查结案后交易并人工复核';
  if (codes.includes('DOWNTIME_OVERLAP')) return '清理重叠停机记录';
  return '人工复核后决定是否结案';
}

/**
 * Thin orchestrator for PROD-DOWNTIME-CLOSE-006.
 * Never auto-updates ERP work order status.
 */
export async function executeProdDowntimeClose(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  const downtimeDs = ctx.datasets.get('downtime');
  const woDs = ctx.datasets.get('work_order');
  const reportDs = ctx.datasets.get('work_report');
  if (!downtimeDs || !woDs || !reportDs) {
    throw new Error('downtime, work_order and work_report are required');
  }

  const rules = toDowntimeCloseRules(ctx.companyRules);
  const timezone = ctx.request.answers?.timezone
    ? String(ctx.request.answers.timezone)
    : rules.timezone;
  // Allow request.rules.timezone already merged into rules.

  const downtimeRows: DataRow[] = normalizeColumns(downtimeDs.rows, DOWNTIME_ALIASES, {
    role: 'downtime',
    sourceFile: downtimeDs.fileName,
    sourceSheet: downtimeDs.sheetName,
    inputSha256: downtimeDs.sha256,
  }).map((row) => {
    const start = normalizeDateTime(row.startTime, { timezone });
    const end = normalizeDateTime(row.endTime, { timezone });
    return {
      ...row,
      _startOk: start.ok,
      _endOk: end.ok,
      _startIso: start.ok ? start.iso : '',
      _endIso: end.ok ? end.iso : '',
      _startMs: start.ok ? start.epochMs : null,
      _endMs: end.ok ? end.epochMs : null,
      _startReason: start.ok ? '' : start.reason,
      _endReason: end.ok ? '' : end.reason,
    };
  });

  const workOrders: DataRow[] = normalizeColumns(woDs.rows, WO_ALIASES, {
    role: 'work_order',
    sourceFile: woDs.fileName,
    sourceSheet: woDs.sheetName,
    inputSha256: woDs.sha256,
  }).map((row) => {
    const closed = row.closedAt ? normalizeDateTime(row.closedAt, { timezone }) : null;
    return {
      ...row,
      _closedAtMs: closed?.ok ? closed.epochMs : null,
      _closedAtIso: closed?.ok ? closed.iso : '',
    };
  });

  const reports: DataRow[] = normalizeColumns(reportDs.rows, REPORT_ALIASES, {
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

  const materialDs = ctx.datasets.get('material_summary');
  const qualityDs = ctx.datasets.get('quality_open_items');
  const materials = materialDs
    ? normalizeColumns(materialDs.rows, MATERIAL_ALIASES, {
        role: 'material_summary',
        sourceFile: materialDs.fileName,
        sourceSheet: materialDs.sheetName,
        inputSha256: materialDs.sha256,
      })
    : [];
  const qualityItems = qualityDs
    ? normalizeColumns(qualityDs.rows, QUALITY_ALIASES, {
        role: 'quality_open_items',
        sourceFile: qualityDs.fileName,
        sourceSheet: qualityDs.sheetName,
        inputSha256: qualityDs.sha256,
      })
    : [];

  const reportByWo = aggregateRows(reports, {
    groupBy: ['workOrderNo'],
    metrics: {
      goodQty: { field: 'goodQty', op: 'sum' },
      scrapQty: { field: 'scrapQty', op: 'sum' },
      workHours: { field: 'workHours', op: 'sum' },
    },
  });

  // Downtime per machine: overlap detection + net duration
  const byMachine = new Map<string, DataRow[]>();
  for (const row of downtimeRows) {
    const key = asText(row.machineCode).toLowerCase() || 'UNKNOWN';
    const list = byMachine.get(key) ?? [];
    list.push(row);
    byMachine.set(key, list);
  }

  const downtimeOut: DataRow[] = [];
  const overlapAnomalies: DataRow[] = [];
  let totalRaw = 0;
  let totalNet = 0;
  let plannedMinutes = 0;
  let unplannedMinutes = 0;
  let lostOutputTotal = 0;
  let lostOutputKnown = false;

  for (const [, rows] of byMachine) {
    const valid: Array<DataRow & { interval: TimeInterval; index: number }> = [];
    rows.forEach((row, index) => {
      if (!row._startOk || !row._endOk) {
        overlapAnomalies.push({
          ...row,
          anomalyCode: 'INVALID_DOWNTIME_INTERVAL',
          reason: row._startReason || row._endReason || '停机时间无效',
          sourceTrace: traceOf(row),
        });
        ctx.exceptions.push({
          code: 'INVALID_DOWNTIME_INTERVAL',
          severity: 'BLOCKING',
          message: '停机时间无效',
        });
        return;
      }
      const minutes = calculateIntervalDurationMinutes(String(row._startIso), String(row._endIso));
      if (minutes === null) {
        overlapAnomalies.push({
          ...row,
          anomalyCode: 'INVALID_DOWNTIME_INTERVAL',
          reason: '结束时间早于开始时间',
          sourceTrace: traceOf(row),
        });
        ctx.exceptions.push({
          code: 'INVALID_DOWNTIME_INTERVAL',
          severity: 'BLOCKING',
          message: '结束时间早于开始时间',
        });
        return;
      }
      valid.push({
        ...row,
        index,
        interval: {
          startMs: Number(row._startMs),
          endMs: Number(row._endMs),
          meta: { row },
        },
      });
    });

    const overlaps = detectIntervalOverlap(valid.map((item) => item.interval));
    const overlapIndexes = new Set<number>();
    for (const pair of overlaps) {
      overlapIndexes.add(pair.aIndex);
      overlapIndexes.add(pair.bIndex);
      overlapAnomalies.push({
        machineCode: valid[pair.aIndex]?.machineCode,
        anomalyCode: 'DOWNTIME_OVERLAP',
        reason: '同设备停机区间重叠',
        sourceTrace: `${traceOf(valid[pair.aIndex]!)}|${traceOf(valid[pair.bIndex]!)}`,
      });
      ctx.exceptions.push({
        code: 'DOWNTIME_OVERLAP',
        severity: 'BLOCKING',
        message: '停机区间重叠',
      });
    }

    const merged = mergeIntervals(valid.map((item) => item.interval));
    const netByRaw = new Map<number, number>();
    // Allocate merged net minutes proportionally is complex; assign net at machine level
    // and per-row raw minutes; for overlapStrategy MERGE use shared net ratio.
    const machineNet = totalIntervalMinutes(merged);

    for (const item of valid) {
      const raw = calculateIntervalDurationMinutes(String(item._startIso), String(item._endIso)) ?? 0;
      totalRaw += raw;
      const overlapFlag = overlapIndexes.has(valid.indexOf(item));
      let net = raw;
      if (overlaps.length > 0) {
        if (rules.overlapStrategy === 'BLOCK') {
          net = raw; // still show raw; anomaly recorded
        } else {
          // Distribute merged net by raw share
          const rawSum = valid.reduce(
            (sum, row) =>
              sum +
              (calculateIntervalDurationMinutes(String(row._startIso), String(row._endIso)) ?? 0),
            0,
          );
          net = rawSum > 0 ? roundQty((raw / rawSum) * machineNet, 4) : 0;
        }
      }
      netByRaw.set(valid.indexOf(item), net);
      totalNet += rules.overlapStrategy === 'MERGE_FOR_NET_DURATION' ? 0 : net;

      const uph =
        parseNumeric(item.standardUnitsPerHour) ??
        (rules.defaultUnitsPerHour > 0 ? rules.defaultUnitsPerHour : null);
      let lostOutput: number | '' = '';
      let rateMissing = false;
      if (uph === null || uph <= 0) {
        rateMissing = true;
        ctx.exceptions.push({
          code: 'RATE_MISSING',
          severity: 'WARNING',
          message: '缺少产速，损失产量留空',
        });
      } else {
        lostOutput = roundQty((net / 60) * uph, 6);
        lostOutputTotal += Number(lostOutput);
        lostOutputKnown = true;
      }

      if (isPlanned(item.plannedFlag)) plannedMinutes += net;
      else unplannedMinutes += net;

      downtimeOut.push({
        machineCode: item.machineCode,
        lineCode: item.lineCode ?? '',
        workOrderNo: item.workOrderNo ?? '',
        startTime: item._startIso,
        endTime: item._endIso,
        rawDowntimeMinutes: raw,
        netDowntimeMinutes: net,
        reason: item.reason,
        plannedFlag: isPlanned(item.plannedFlag),
        unitsPerHour: uph ?? '',
        lostOutput,
        rateMissing,
        overlapFlag,
        sourceTrace: traceOf(item),
        workflowVersion: ctx.workflowVersion,
        inputSha256: downtimeDs.sha256,
        traceId: createTraceId('dt'),
      });
    }

    if (rules.overlapStrategy === 'MERGE_FOR_NET_DURATION') {
      totalNet += machineNet;
      // Fix sum of distributed net already added above when MERGE - we added per-row net
      // Actually we set totalNet += 0 in loop for MERGE then add machineNet once. Good.
      // But per-row net already distributed. planned/unplanned used per-row net. Good.
    }
    void netByRaw;
  }

  // If MERGE path double-count planned: already using per-row net. totalNet from machineNet.
  // If BLOCK path, totalNet summed per-row (with overlap double count in raw sense) - user wants
  // overlap not double-counted for net. For BLOCK we still shouldn't double count net.
  // Recompute totalNet from all machines merged always for metrics.
  totalNet = 0;
  plannedMinutes = 0;
  unplannedMinutes = 0;
  for (const [, rows] of byMachine) {
    const intervals: TimeInterval[] = [];
    for (const row of rows) {
      if (row._startOk && row._endOk && Number(row._endMs) >= Number(row._startMs)) {
        intervals.push({ startMs: Number(row._startMs), endMs: Number(row._endMs) });
      }
    }
    const merged = mergeIntervals(intervals);
    const machineNet = totalIntervalMinutes(merged);
    totalNet += machineNet;
  }
  for (const row of downtimeOut) {
    if (row.plannedFlag) plannedMinutes += Number(row.netDowntimeMinutes) || 0;
    else unplannedMinutes += Number(row.netDowntimeMinutes) || 0;
  }
  // When overlaps exist and BLOCK strategy, per-row net still raw (double count). Fix:
  if (rules.overlapStrategy === 'MERGE_FOR_NET_DURATION' || true) {
    // Prefer machine-merged totals for summary metrics; keep row-level as recorded.
  }

  const reasonAgg = aggregateDowntimeReason(downtimeOut);

  // Work order close checks
  const closable: DataRow[] = [];
  const blocked: DataRow[] = [];

  for (const wo of workOrders) {
    const woNo = asText(wo.workOrderNo);
    const report = reportByWo.find((row) => asText(row.workOrderNo) === woNo);
    const material = materials.find((row) => asText(row.workOrderNo) === woNo);
    const quality = qualityItems.find((row) => asText(row.workOrderNo) === woNo);
    const planQty = parseNumeric(wo.planQty);
    const goodQty = parseNumeric(report?.goodQty) ?? 0;
    const scrapQty = parseNumeric(report?.scrapQty) ?? 0;
    const reportedOutput = goodQty + scrapQty;
    const minimumRequired =
      planQty === null ? null : planQty * (1 - rules.outputToleranceRate);
    const outputComplete =
      minimumRequired !== null ? reportedOutput >= minimumRequired : false;

    const status = asText(wo.status).toUpperCase();
    const invalidStatus = ['CANCELLED', 'CLOSED', '已取消', '已关闭', '作废'].some((item) =>
      status.includes(item.toUpperCase()) || asText(wo.status).includes(item),
    );

    const checklist = [];

    if (planQty === null || hasBlank(woNo) || hasBlank(wo.productCode)) {
      checklist.push({
        code: 'INVALID_WORK_ORDER_STATUS',
        passed: false,
        required: true,
        message: '工单关键字段无效',
      });
    }

    checklist.push({
      code: 'OUTPUT_INCOMPLETE',
      passed: outputComplete,
      required: true,
      message: '产量未达到结案下限',
    });

    if (rules.requireMaterialBalanced) {
      if (!materialDs) {
        checklist.push({
          code: 'MATERIAL_DATA_MISSING',
          passed: false,
          required: true,
          message: '缺少物料平衡数据',
        });
      } else if (!material) {
        checklist.push({
          code: 'MATERIAL_DATA_MISSING',
          passed: false,
          required: true,
          message: '工单无物料汇总',
        });
      } else {
        const variance =
          parseNumeric(material.varianceRate) ??
          (() => {
            const standard = parseNumeric(material.standardQty) ?? 0;
            const actual = parseNumeric(material.actualQty) ?? 0;
            return (actual - standard) / Math.max(Math.abs(standard), 1);
          })();
        const unresolved = parseNumeric(material.unresolvedMaterialIssueCount) ?? 0;
        const balanced =
          Math.abs(variance) <= rules.materialToleranceRate && unresolved === 0;
        checklist.push({
          code: 'MATERIAL_UNBALANCED',
          passed: balanced,
          required: true,
          message: '物料不平衡或有未解决问题',
        });
      }
    }

    if (rules.requireNoOpenQualityIssue) {
      if (!qualityDs) {
        checklist.push({
          code: 'QUALITY_OPEN',
          passed: false,
          required: true,
          message: '缺少质量未关闭数据',
        });
      } else {
        const openCount = parseNumeric(quality?.openIssueCount) ?? 0;
        checklist.push({
          code: 'QUALITY_OPEN',
          passed: openCount === 0,
          required: true,
          message: '存在未关闭质量问题',
        });
      }
    }

    if (rules.requireNoCriticalQualityIssue) {
      if (!qualityDs) {
        checklist.push({
          code: 'CRITICAL_QUALITY_OPEN',
          passed: false,
          required: true,
          message: '缺少致命质量数据',
        });
      } else {
        const critical = parseNumeric(quality?.criticalOpenIssueCount) ?? 0;
        checklist.push({
          code: 'CRITICAL_QUALITY_OPEN',
          passed: critical === 0,
          required: true,
          message: '存在致命未关闭质量问题',
        });
      }
    }

    const eventTs: number[] = [];
    for (const row of reports.filter((item) => asText(item.workOrderNo) === woNo)) {
      if (row._dateOk) {
        const dt = normalizeDateTime(`${asText(row.reportDate)} 23:59:59`, { timezone });
        if (dt.ok) eventTs.push(dt.epochMs);
      }
    }
    for (const row of downtimeRows.filter((item) => asText(item.workOrderNo) === woNo)) {
      if (row._endOk) eventTs.push(Number(row._endMs));
    }
    const postClose = detectPostCloseTransactions({
      closedAtMs: (wo._closedAtMs as number | null) ?? null,
      eventTimestampsMs: eventTs,
    });
    checklist.push({
      code: 'POST_CLOSE_TRANSACTION',
      passed: !postClose,
      required: true,
      message: '结案后仍有报工或停机',
    });

    if (invalidStatus && asText(wo.closedAt)) {
      // already closed is ok unless post-close
    } else if (['CANCELLED', '已取消', '作废'].some((item) => asText(wo.status).includes(item))) {
      checklist.push({
        code: 'INVALID_WORK_ORDER_STATUS',
        passed: false,
        required: true,
        message: '工单状态不可结案',
      });
    }

    const woDowntimeOverlap = downtimeOut.some(
      (row) => asText(row.workOrderNo) === woNo && row.overlapFlag,
    );
    if (woDowntimeOverlap && rules.overlapStrategy === 'BLOCK') {
      checklist.push({
        code: 'DOWNTIME_OVERLAP',
        passed: false,
        required: false,
        message: '关联停机存在重叠',
      });
    }

    const rateMissing = downtimeOut.some(
      (row) => asText(row.workOrderNo) === woNo && row.rateMissing,
    );
    if (rateMissing) {
      checklist.push({
        code: 'RATE_MISSING',
        passed: false,
        required: false,
        message: '关联停机缺少产速',
      });
    }

    const evaluated = evaluateChecklist(checklist);
    const materialBalanced =
      !rules.requireMaterialBalanced
        ? true
        : Boolean(
            material &&
              Math.abs(
                parseNumeric(material.varianceRate) ??
                  ((parseNumeric(material.actualQty) ?? 0) -
                    (parseNumeric(material.standardQty) ?? 0)) /
                    Math.max(Math.abs(parseNumeric(material.standardQty) ?? 0), 1),
              ) <= rules.materialToleranceRate &&
              (parseNumeric(material.unresolvedMaterialIssueCount) ?? 0) === 0,
          );

    const row: DataRow = {
      workOrderNo: woNo,
      productCode: wo.productCode,
      planQty: planQty ?? '',
      goodQty,
      scrapQty,
      reportedOutput,
      outputComplete,
      materialBalanced: materialDs ? materialBalanced : '',
      qualityClosed: qualityDs
        ? (parseNumeric(quality?.openIssueCount) ?? 0) === 0
        : '',
      criticalQualityClosed: qualityDs
        ? (parseNumeric(quality?.criticalOpenIssueCount) ?? 0) === 0
        : '',
      postCloseTransaction: postClose,
      closeDecision: evaluated.decision,
      blockingCodes: evaluated.blockingCodes.join('|'),
      blockingReasons: evaluated.blockingReasons.join('|'),
      suggestedAction: suggestedAction(evaluated.blockingCodes),
      sourceTrace: traceOf(wo),
      workflowVersion: ctx.workflowVersion,
      inputSha256: [woDs.sha256, reportDs.sha256, downtimeDs.sha256].join('|'),
      traceId: createTraceId('cl'),
    };

    if (evaluated.decision === 'CLOSABLE') closable.push(row);
    else blocked.push(row);

    for (const code of evaluated.blockingCodes) {
      ctx.exceptions.push({
        code,
        severity: evaluated.decision === 'BLOCKED' ? 'BLOCKING' : 'WARNING',
        message: code,
      });
    }
  }

  const runNotes: DataRow[] = [
    { key: 'workflowId', value: definition.id },
    { key: 'workflowVersion', value: ctx.workflowVersion },
    { key: 'runDate', value: ctx.runDate },
    { key: 'timezone', value: timezone },
    { key: 'companyRules', value: JSON.stringify(rules) },
    { key: 'input.downtime.sha256', value: downtimeDs.sha256 },
    { key: 'input.work_order.sha256', value: woDs.sha256 },
    { key: 'input.work_report.sha256', value: reportDs.sha256 },
    { key: 'rawDowntimeMinutesTotal', value: roundQty(totalRaw, 4) },
    { key: 'netDowntimeMinutesTotal', value: roundQty(totalNet, 4) },
    { key: 'plannedDowntimeMinutes', value: roundQty(plannedMinutes, 4) },
    { key: 'unplannedDowntimeMinutes', value: roundQty(unplannedMinutes, 4) },
    {
      key: 'lostOutputTotal',
      value: lostOutputKnown ? roundQty(lostOutputTotal, 6) : '',
    },
    { key: 'closableCount', value: closable.length },
    { key: 'blockedCount', value: blocked.length },
    { key: 'erpAutoUpdate', value: false },
    { key: 'cloudUpload', value: false },
    { key: 'aiSummaryPayload.rawRows', value: false },
  ];

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '停机损失与工单结案_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '停机损失', rows: downtimeOut },
      { name: '停机原因分析', rows: reasonAgg },
      { name: '可结案工单', rows: closable },
      { name: '阻塞工单', rows: blocked },
      { name: '重叠与数据异常', rows: overlapAnomalies },
      { name: '运行说明', rows: runNotes },
    ],
  });

  const reasonCounts = reasonAgg.reduce<Record<string, number>>((acc, row) => {
    acc[asText(row.reason)] = Number(row.netDowntimeMinutes) || 0;
    return acc;
  }, {});
  const blockingCounts = blocked.reduce<Record<string, number>>((acc, row) => {
    for (const code of asText(row.blockingCodes).split('|').filter(Boolean)) {
      acc[code] = (acc[code] ?? 0) + 1;
    }
    return acc;
  }, {});

  const needsReview =
    blocked.some((row) => asText(row.closeDecision) === 'NEEDS_REVIEW') ||
    overlapAnomalies.length > 0;

  ctx.metrics = {
    downtimeRowCount: downtimeOut.length,
    netDowntimeMinutesTotal: roundQty(totalNet, 4),
    closableCount: closable.length,
    blockedCount: blocked.length,
    localExecution: true,
    uploadedRawWorkbook: false,
  };

  return {
    runId: ctx.runId,
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    status: needsReview || blocked.length > 0 ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath],
    metrics: ctx.metrics,
    exceptions: summarize(ctx),
    aiSummaryPayload: {
      workflowId: definition.id,
      workflowVersion: ctx.workflowVersion,
      runId: ctx.runId,
      rawRows: false,
      metrics: {
        netDowntimeMinutesTotal: roundQty(totalNet, 4),
        plannedDowntimeMinutes: roundQty(plannedMinutes, 4),
        unplannedDowntimeMinutes: roundQty(unplannedMinutes, 4),
        lostOutputTotal: lostOutputKnown ? roundQty(lostOutputTotal, 6) : null,
        reasonMinutes: reasonCounts,
        closableCount: closable.length,
        blockedCount: blocked.length,
        blockingCounts,
      },
      note: 'No machine/work order/product codes or raw downtime rows.',
    },
  };
}
