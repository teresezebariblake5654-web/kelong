import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { aggregateRows } from '../operators/aggregate.js';
import { daysBetween, isInFreezeWindow } from '../operators/dateWindow.js';
import { deduplicateByVersion } from '../operators/deduplicateVersions.js';
import { deriveRows } from '../operators/derive.js';
import { asText, parseNumeric, roundQty, type FieldAliasMap } from '../operators/fieldUtils.js';
import { joinRows } from '../operators/join.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import {
  normalizePlanStatus,
  type NormalizedPlanStatus,
} from '../operators/normalizeStatus.js';
import { sortProductionPlans } from '../operators/sortByPriority.js';
import { toProductionPlanRules } from '../rules/RuleStore.js';
import { createTraceId } from '../SourceTrace.js';
import type { OperatorContext } from '../types.js';

const PLAN_ALIASES: FieldAliasMap = {
  planNo: ['计划号', '生产计划号', '计划单号', '工单号', 'plan_no'],
  productCode: ['产品编码', '成品编码', '物料编码', '产品料号', 'product_code'],
  planQty: ['计划数量', '生产数量', '需求数量', '计划产量', 'plan_qty'],
  dueDate: ['交期', '要求完成日期', '计划完成日期', '交货日期', 'due_date'],
  plannedStartDate: ['计划开始日期', '开工日期', '预计开工日期', 'planned_start_date'],
  planDate: ['计划日期', 'plan_date'],
  lineCode: ['产线', '生产线', '线体', '产线编码', 'line_code'],
  planStatus: ['状态', '计划状态', '生产状态', 'plan_status'],
  version: ['版本', '计划版本', '版本号', 'revision'],
  updatedAt: ['更新时间', '修改时间', '最后更新时间', 'updated_at'],
  customerPriority: ['客户优先级', '优先级', 'customer_priority'],
  materialReady: ['齐套', '物料齐套', 'material_ready'],
  warehouse: ['仓库', 'warehouse'],
  unit: ['单位', 'unit'],
  orderNo: ['订单号', '销售订单', 'order_no'],
};

const STOCK_ALIASES: FieldAliasMap = {
  productCode: ['产品编码', '成品编码', '物料编码', 'product_code'],
  warehouse: ['仓库', 'warehouse'],
  availableQty: ['可用库存', '库存数量', 'available_qty', '现存量'],
  reservedQty: ['预留库存', '预留数量', 'reserved_qty', '占用库存'],
};

const CAPACITY_ALIASES: FieldAliasMap = {
  lineCode: ['产线', '生产线', '线体', '产线编码', 'line_code'],
  date: ['日期', '产能日期', 'date'],
  availableHours: ['可用工时', '产能工时', 'available_hours'],
  unitsPerHour: ['每小时产量', '小时产能', 'units_per_hour', 'UPH'],
};

const ORDER_ALIASES: FieldAliasMap = {
  orderNo: ['订单号', '销售订单', 'order_no'],
  productCode: ['产品编码', '成品编码', 'product_code'],
  orderQty: ['订单数量', '订购数量', 'order_qty'],
  dueDate: ['交期', '交货日期', 'due_date'],
  customerPriority: ['客户优先级', '优先级', 'customer_priority'],
};

type ResultStatus =
  | 'READY'
  | 'OVERDUE'
  | 'STOCK_COVERED'
  | 'CAPACITY_SHORTAGE'
  | 'FROZEN_CHANGE'
  | 'DUPLICATE_CONFLICT'
  | 'BLOCKED_STATUS'
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_QTY'
  | 'INVALID_DATE'
  | 'UNKNOWN_STATUS';

function sourceTrace(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function pushEx(
  ctx: OperatorContext,
  code: string,
  severity: 'INFO' | 'WARNING' | 'BLOCKING',
  message: string,
) {
  ctx.exceptions.push({ code, severity, message });
}

function suggestedAction(code: ResultStatus): string {
  switch (code) {
    case 'DUPLICATE_CONFLICT':
      return '人工确认保留哪个计划版本';
    case 'FROZEN_CHANGE':
      return '冻结窗口内版本变化，需人工确认';
    case 'CAPACITY_SHORTAGE':
      return '调整产线产能、交期或计划数量';
    case 'INVALID_DATE':
      return '修正为 YYYY-MM-DD / YYYY年MM月DD日 等明确日期';
    case 'UNKNOWN_STATUS':
      return '将计划状态改为可识别状态';
    case 'MISSING_REQUIRED_FIELD':
      return '补齐计划号/产品/数量/交期';
    case 'INVALID_QTY':
      return '修正计划数量为正数';
    case 'BLOCKED_STATUS':
      return '该状态不可执行，忽略或重新下达';
    case 'STOCK_COVERED':
      return '库存已覆盖，无需排产';
    default:
      return '检查计划数据后重试';
  }
}

/**
 * Thin orchestrator for PROD-PLAN-CLEAN-003.
 * Date/status/dedupe/sort/join/aggregate/derive live in reusable operators.
 */
export async function executeProdPlanClean(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  const planDs = ctx.datasets.get('production_plan');
  if (!planDs) throw new Error('production_plan is required');

  const rules = toProductionPlanRules(ctx.companyRules);
  const stockDs = ctx.datasets.get('finished_stock');
  const capacityDs = ctx.datasets.get('capacity');
  const orderDs = ctx.datasets.get('customer_orders');
  const capacityChecked = Boolean(capacityDs) && rules.capacityCheckEnabled;

  const planRows: DataRow[] = normalizeColumns(planDs.rows, PLAN_ALIASES, {
    role: 'production_plan',
    sourceFile: planDs.fileName,
    sourceSheet: planDs.sheetName,
    inputSha256: planDs.sha256,
  }).map((row) => {
    const due = normalizeDate(row.dueDate, { excelDateSystem: rules.excelDateSystem });
    const start = normalizeDate(row.plannedStartDate, {
      excelDateSystem: rules.excelDateSystem,
    });
    const normalizedStatus = normalizePlanStatus(row.planStatus);
    return {
      ...row,
      dueDate: due.ok ? due.value : row.dueDate,
      _dueDateOk: due.ok,
      _dueDateReason: due.ok ? '' : due.reason,
      plannedStartDate: start.ok ? start.value : asText(row.plannedStartDate),
      _startDateOk: !asText(row.plannedStartDate) || start.ok,
      normalizedStatus,
    };
  });

  const deduped = deduplicateByVersion(planRows, {
    strategy: rules.duplicateStrategy,
  });

  // Frozen-window version change: discarded supersession where selected is frozen.
  const frozenChangeKeys = new Set<string>();
  for (const discarded of deduped.discarded) {
    if (asText(discarded._dedupeStatus) !== 'VERSION_SUPERSEDED') continue;
    const selected = deduped.selected.find(
      (row) =>
        asText(row.planNo) === asText(discarded.planNo) &&
        asText(row.productCode) === asText(discarded.productCode) &&
        asText(row.lineCode) === asText(discarded.lineCode),
    );
    if (!selected) continue;
    const frozen = isInFreezeWindow({
      plannedStartYmd: asText(selected.plannedStartDate) || null,
      runDateYmd: ctx.runDate,
      freezeDays: rules.freezeDays,
    });
    if (frozen) {
      const key = `${asText(selected.planNo)}||${asText(selected.productCode)}||${asText(selected.lineCode)}`;
      frozenChangeKeys.add(key);
      selected._frozenChange = true;
    }
  }

  let stockAgg: DataRow[] = [];
  if (stockDs) {
    const stockRows = normalizeColumns(stockDs.rows, STOCK_ALIASES, {
      role: 'finished_stock',
      sourceFile: stockDs.fileName,
      sourceSheet: stockDs.sheetName,
      inputSha256: stockDs.sha256,
    }).map((row) => ({
      ...row,
      availableQty: parseNumeric(row.availableQty) ?? 0,
      reservedQty: parseNumeric(row.reservedQty) ?? 0,
    }));
    stockAgg = deriveRows(
      aggregateRows(stockRows, {
        groupBy: ['productCode'],
        metrics: {
          availableQty: { field: 'availableQty', op: 'sum' },
          reservedQty: { field: 'reservedQty', op: 'sum' },
        },
      }),
      {
        netAvailableQty: 'max(availableQty - reservedQty, 0)',
      },
    );
  }

  let capacityRows: DataRow[] = [];
  if (capacityDs && rules.capacityCheckEnabled) {
    capacityRows = normalizeColumns(capacityDs.rows, CAPACITY_ALIASES, {
      role: 'capacity',
      sourceFile: capacityDs.fileName,
      sourceSheet: capacityDs.sheetName,
      inputSha256: capacityDs.sha256,
    }).map((row) => {
      const date = normalizeDate(row.date, { excelDateSystem: rules.excelDateSystem });
      return {
        ...row,
        date: date.ok ? date.value : row.date,
        _dateOk: date.ok,
        availableHours: parseNumeric(row.availableHours) ?? 0,
        unitsPerHour: parseNumeric(row.unitsPerHour) ?? 0,
      };
    });
  }

  let orderRows: DataRow[] = [];
  if (orderDs) {
    orderRows = normalizeColumns(orderDs.rows, ORDER_ALIASES, {
      role: 'customer_orders',
      sourceFile: orderDs.fileName,
      sourceSheet: orderDs.sheetName,
      inputSha256: orderDs.sha256,
    });
  }

  // Enrich selected plans with stock (by productCode) — left join.
  const withStock: DataRow[] =
    stockAgg.length > 0
      ? joinRows({
          left: deduped.selected,
          right: stockAgg.map((row) => ({
            productCode: row.productCode,
            netAvailableQty: row.netAvailableQty,
            availableQty: row.availableQty,
            reservedQty: row.reservedQty,
          })),
          keys: ['productCode'],
          joinType: 'left',
        })
      : deduped.selected.map((row) => ({ ...row, netAvailableQty: 0 }));

  // Optional order enrichment: exact orderNo then productCode (no fuzzy match).
  const withOrders: DataRow[] = withStock.map((row) => {
    const enriched: DataRow = { ...row };
    if (orderRows.length > 0) {
      const byOrder = asText(row.orderNo)
        ? orderRows.find((order) => asText(order.orderNo) === asText(row.orderNo))
        : undefined;
      const byProduct = orderRows.find(
        (order) => asText(order.productCode) === asText(row.productCode),
      );
      const matched = byOrder ?? byProduct;
      if (matched) {
        if (!asText(enriched.orderNo)) enriched.orderNo = matched.orderNo;
        if (enriched.customerPriority === undefined || enriched.customerPriority === '') {
          enriched.customerPriority = matched.customerPriority;
        }
      }
    }
    return enriched;
  });

  const computed: DataRow[] = withOrders.map((row) => {
    const planQty = parseNumeric(row.planQty);
    const netAvailableQty = parseNumeric(row.netAvailableQty) ?? 0;
    const netRequiredQty =
      planQty === null ? null : roundQty(Math.max((planQty ?? 0) - netAvailableQty, 0));

    const dueOk = Boolean(row._dueDateOk);
    const dueDate = dueOk ? asText(row.dueDate) : '';
    const daysToDue = dueOk ? daysBetween(ctx.runDate, dueDate) : null;
    const overdue = daysToDue !== null && daysToDue < 0;

    const startYmd = asText(row.plannedStartDate);
    const capacityDate = startYmd || dueDate;
    const lineCode = asText(row.lineCode);
    let availableHours: number | '' = '';
    let unitsPerHour: number | '' = '';
    let requiredHours: number | '' = '';
    let capacityGapHours: number | '' = '';
    let rowCapacityChecked = false;

    if (capacityChecked && lineCode && capacityDate) {
      const cap = capacityRows.find(
        (item) =>
          asText(item.lineCode) === lineCode &&
          asText(item.date) === capacityDate &&
          item._dateOk,
      );
      if (cap && (parseNumeric(cap.unitsPerHour) ?? 0) > 0) {
        rowCapacityChecked = true;
        availableHours = parseNumeric(cap.availableHours) ?? 0;
        unitsPerHour = parseNumeric(cap.unitsPerHour) ?? 0;
        if (netRequiredQty !== null) {
          requiredHours = roundQty(netRequiredQty / Number(unitsPerHour), 6);
          capacityGapHours = roundQty(
            Math.max(Number(requiredHours) - Number(availableHours), 0),
            6,
          );
        }
      }
    }

    const isFrozen = isInFreezeWindow({
      plannedStartYmd: startYmd || null,
      runDateYmd: ctx.runDate,
      freezeDays: rules.freezeDays,
    });

    return {
      ...row,
      planQty: planQty ?? row.planQty,
      netAvailableQty,
      netRequiredQty: netRequiredQty ?? '',
      daysToDue: daysToDue ?? '',
      overdue,
      isFrozen,
      availableHours,
      unitsPerHour,
      requiredHours,
      capacityGapHours,
      capacityChecked: rowCapacityChecked,
      materialReady: row.materialReady ?? '',
    };
  });

  const executable: DataRow[] = [];
  const blocked: DataRow[] = [];
  const stockCovered: DataRow[] = [];
  const capacityGaps: DataRow[] = [];

  for (const row of [...deduped.conflicts]) {
    blocked.push(
      finalizeBlocked(row, 'DUPLICATE_CONFLICT', '无法判定保留哪个重复计划版本', ctx),
    );
    pushEx(ctx, 'DUPLICATE_CONFLICT', 'BLOCKING', '重复计划冲突');
  }

  for (const row of computed) {
    const status = asText(row.normalizedStatus) as NormalizedPlanStatus;
    const planQty = parseNumeric(row.planQty);
    const missing =
      hasBlank(row.planNo) || hasBlank(row.productCode) || hasBlank(String(row.planQty ?? ''));

    let resultStatus: ResultStatus | null = null;
    let reason = '';

    if (missing) {
      resultStatus = 'MISSING_REQUIRED_FIELD';
      reason = '关键字段缺失';
    } else if (!row._dueDateOk || row._startDateOk === false) {
      resultStatus = 'INVALID_DATE';
      reason = asText(row._dueDateReason) || '日期无效或歧义';
    } else if (planQty === null || planQty <= 0) {
      resultStatus = 'INVALID_QTY';
      reason = '计划数量为零、负数或无法解析';
    } else if (status === 'UNKNOWN') {
      resultStatus = 'UNKNOWN_STATUS';
      reason = '未知计划状态';
    } else if (rules.ignoredStatuses.includes(status)) {
      resultStatus = 'BLOCKED_STATUS';
      reason = `状态 ${status} 不参与排产`;
    } else if (!rules.executableStatuses.includes(status)) {
      resultStatus = 'BLOCKED_STATUS';
      reason = `状态 ${status} 不在可执行列表`;
    } else if (row._frozenChange) {
      resultStatus = 'FROZEN_CHANGE';
      reason = '冻结窗口内发生版本变化';
    } else if (parseNumeric(row.netRequiredQty) === 0) {
      resultStatus = 'STOCK_COVERED';
      reason = '库存完全覆盖净需求';
    } else if (
      row.capacityChecked &&
      parseNumeric(row.capacityGapHours) !== null &&
      (parseNumeric(row.capacityGapHours) ?? 0) > 0
    ) {
      resultStatus = 'CAPACITY_SHORTAGE';
      reason = '明确产线日期产能不足';
    } else if (row.overdue) {
      resultStatus = 'OVERDUE';
      reason = '交期已逾期，仍可执行但需优先处理';
    } else {
      resultStatus = 'READY';
      reason = '可执行';
    }

    const finalized = {
      ...row,
      resultStatus,
      reason,
      sourceFile: asText(row._sourceFile) || planDs.fileName,
      sourceSheet: asText(row._sourceSheet) || planDs.sheetName,
      sourceRow: row._sourceRow ?? '',
      workflowVersion: ctx.workflowVersion,
      inputSha256: asText(row._inputSha256) || planDs.sha256,
      sourceTrace: sourceTrace(row),
      traceId: createTraceId('pc'),
    };

    if (resultStatus === 'STOCK_COVERED') {
      stockCovered.push(finalized);
    } else if (resultStatus === 'CAPACITY_SHORTAGE') {
      capacityGaps.push(finalized);
      blocked.push(
        finalizeBlocked(finalized, resultStatus, reason, ctx, {
          blockedCode: resultStatus,
        }),
      );
      pushEx(ctx, resultStatus, 'BLOCKING', reason);
    } else if (
      resultStatus === 'READY' ||
      resultStatus === 'OVERDUE'
    ) {
      executable.push(finalized);
      if (resultStatus === 'OVERDUE') {
        // Overdue stays executable; also flag in metrics/exceptions as warning.
        pushEx(ctx, 'OVERDUE', 'WARNING', reason);
      }
    } else {
      blocked.push(
        finalizeBlocked(finalized, resultStatus!, reason, ctx, {
          blockedCode: resultStatus!,
        }),
      );
      pushEx(ctx, resultStatus!, 'BLOCKING', reason);
    }
  }

  const sortedExecutable: DataRow[] = sortProductionPlans(executable, {
    priorityRule: rules.priorityRule,
  }).map((row, index) => ({
    ...row,
    priorityIndex: index + 1,
    resultStatus: row.overdue ? 'OVERDUE' : row.resultStatus,
  }));

  const rawPlanQtyTotal = planRows.reduce(
    (sum, row) => sum + (parseNumeric(row.planQty) ?? 0),
    0,
  );
  const selectedPlanQtyTotal = deduped.selected.reduce(
    (sum, row) => sum + (parseNumeric(row.planQty) ?? 0),
    0,
  );
  const executableNetRequiredQtyTotal = sortedExecutable.reduce(
    (sum, row) => sum + (parseNumeric(row.netRequiredQty) ?? 0),
    0,
  );
  const stockCoveredQtyTotal = stockCovered.reduce(
    (sum, row) => sum + (parseNumeric(row.planQty) ?? 0),
    0,
  );
  const blockedPlanQtyTotal = blocked.reduce(
    (sum, row) => sum + (parseNumeric(row.planQty) ?? 0),
    0,
  );

  const duplicateSheet = [
    ...deduped.discarded.map((row) => ({
      planNo: row.planNo,
      productCode: row.productCode,
      lineCode: row.lineCode,
      version: row.version,
      updatedAt: row.updatedAt,
      planQty: row.planQty,
      dedupeStatus: row._dedupeStatus,
      selectedSourceTrace: row.selectedSourceTrace,
      discardedSourceTrace: row.discardedSourceTrace,
      sourceTrace: sourceTrace(row),
    })),
    ...deduped.conflicts.map((row) => ({
      planNo: row.planNo,
      productCode: row.productCode,
      lineCode: row.lineCode,
      version: row.version,
      updatedAt: row.updatedAt,
      planQty: row.planQty,
      dedupeStatus: 'DUPLICATE_CONFLICT',
      selectedSourceTrace: '',
      discardedSourceTrace: sourceTrace(row),
      sourceTrace: sourceTrace(row),
    })),
  ];

  const runNotes: DataRow[] = [
    { key: 'workflowId', value: definition.id },
    { key: 'workflowVersion', value: ctx.workflowVersion },
    { key: 'runDate', value: ctx.runDate },
    { key: 'companyId', value: ctx.request.companyId ?? '' },
    { key: 'companyRules', value: JSON.stringify(rules) },
    { key: 'input.production_plan.fileName', value: planDs.fileName },
    { key: 'input.production_plan.sha256', value: planDs.sha256 },
    { key: 'input.production_plan.rowCount', value: planRows.length },
    {
      key: 'input.finished_stock.fileName',
      value: stockDs?.fileName ?? '',
    },
    {
      key: 'input.finished_stock.sha256',
      value: stockDs?.sha256 ?? '',
    },
    {
      key: 'input.capacity.fileName',
      value: capacityDs?.fileName ?? '',
    },
    {
      key: 'input.capacity.sha256',
      value: capacityDs?.sha256 ?? '',
    },
    {
      key: 'capacityChecked',
      value: capacityChecked,
    },
    {
      key: 'capacityNote',
      value: capacityChecked ? '已进行明确产线+日期产能核验' : '未进行产能核验',
    },
    { key: 'exactDuplicateCount', value: deduped.exactDuplicateCount },
    { key: 'multiVersionDuplicateCount', value: deduped.multiVersionDuplicateCount },
    { key: 'selectedPlanCount', value: deduped.selected.length },
    { key: 'executableCount', value: sortedExecutable.length },
    { key: 'blockedCount', value: blocked.length },
    { key: 'stockCoveredCount', value: stockCovered.length },
    { key: 'capacityShortageCount', value: capacityGaps.length },
    {
      key: 'overdueCount',
      value: sortedExecutable.filter((row) => row.overdue).length,
    },
    { key: 'rawPlanQtyTotal', value: roundQty(rawPlanQtyTotal) },
    { key: 'selectedPlanQtyTotal', value: roundQty(selectedPlanQtyTotal) },
    {
      key: 'executableNetRequiredQtyTotal',
      value: roundQty(executableNetRequiredQtyTotal),
    },
    { key: 'stockCoveredQtyTotal', value: roundQty(stockCoveredQtyTotal) },
    { key: 'blockedPlanQtyTotal', value: roundQty(blockedPlanQtyTotal) },
    { key: 'cloudUpload', value: false },
    { key: 'aiSummaryPayload.rawRows', value: false },
  ];

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '可执行生产计划_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );

  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      {
        name: '可执行计划',
        rows: sortedExecutable.map((row) => pickExecutable(row)),
      },
      {
        name: '阻塞计划',
        rows: blocked,
      },
      {
        name: '重复计划',
        rows: duplicateSheet,
      },
      {
        name: '产能缺口',
        rows: capacityGaps.map((row) => pickExecutable(row)),
      },
      {
        name: '库存覆盖',
        rows: stockCovered.map((row) => pickExecutable(row)),
      },
      {
        name: '运行说明',
        rows: runNotes,
      },
    ],
  });

  const needsReview =
    deduped.conflicts.length > 0 ||
    frozenChangeKeys.size > 0 ||
    blocked.some((row) =>
      [
        'DUPLICATE_CONFLICT',
        'FROZEN_CHANGE',
        'INVALID_DATE',
        'UNKNOWN_STATUS',
        'MISSING_REQUIRED_FIELD',
        'CAPACITY_SHORTAGE',
        'INVALID_QTY',
      ].includes(asText(row.blockedCode)),
    );

  const statusCounts = [...sortedExecutable, ...blocked, ...stockCovered].reduce<
    Record<string, number>
  >((acc, row) => {
    const key = asText(row.resultStatus || row.blockedCode) || 'UNKNOWN';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const blockedReasonCounts = blocked.reduce<Record<string, number>>((acc, row) => {
    const key = asText(row.blockedCode) || 'UNKNOWN';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  ctx.metrics = {
    rawPlanCount: planRows.length,
    selectedPlanCount: deduped.selected.length,
    executableCount: sortedExecutable.length,
    blockedCount: blocked.length,
    overdueCount: sortedExecutable.filter((row) => row.overdue).length,
    stockCoveredCount: stockCovered.length,
    capacityShortageCount: capacityGaps.length,
    executableNetRequiredQtyTotal: roundQty(executableNetRequiredQtyTotal),
    rawPlanQtyTotal: roundQty(rawPlanQtyTotal),
    selectedPlanQtyTotal: roundQty(selectedPlanQtyTotal),
    stockCoveredQtyTotal: roundQty(stockCoveredQtyTotal),
    blockedPlanQtyTotal: roundQty(blockedPlanQtyTotal),
    capacityChecked,
    localExecution: true,
    uploadedRawWorkbook: false,
  };

  const aiSummaryPayload = {
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    runId: ctx.runId,
    rawRows: false,
    metrics: {
      rawPlanCount: planRows.length,
      selectedPlanCount: deduped.selected.length,
      executableCount: sortedExecutable.length,
      blockedCount: blocked.length,
      overdueCount: sortedExecutable.filter((row) => row.overdue).length,
      stockCoveredCount: stockCovered.length,
      capacityShortageCount: capacityGaps.length,
      executableNetRequiredQtyTotal: roundQty(executableNetRequiredQtyTotal),
      statusCounts,
      blockedReasonCounts,
    },
    note: 'Desensitized aggregates only. No plan/order/product codes or file paths.',
  };

  return {
    runId: ctx.runId,
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    status: needsReview ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath],
    metrics: ctx.metrics,
    exceptions: summarize(ctx),
    aiSummaryPayload,
  };
}

function finalizeBlocked(
  row: DataRow,
  code: ResultStatus | string,
  reason: string,
  ctx: OperatorContext,
  extra?: Record<string, unknown>,
): DataRow {
  return {
    planNo: row.planNo,
    productCode: row.productCode,
    lineCode: row.lineCode,
    orderNo: row.orderNo,
    planQty: row.planQty,
    dueDate: row.dueDate,
    plannedStartDate: row.plannedStartDate,
    normalizedStatus: row.normalizedStatus,
    version: row.version,
    blockedCode: code,
    blockedReason: reason,
    suggestedAction: suggestedAction(code as ResultStatus),
    resultStatus: code,
    reason,
    sourceTrace: sourceTrace(row),
    sourceFile: row._sourceFile,
    sourceSheet: row._sourceSheet,
    sourceRow: row._sourceRow,
    workflowVersion: ctx.workflowVersion,
    inputSha256: row._inputSha256,
    ...extra,
  };
}

function pickExecutable(row: DataRow): DataRow {
  return {
    priorityIndex: row.priorityIndex ?? '',
    planNo: row.planNo,
    orderNo: row.orderNo ?? '',
    productCode: row.productCode,
    lineCode: row.lineCode ?? '',
    normalizedStatus: row.normalizedStatus,
    planQty: row.planQty,
    netAvailableQty: row.netAvailableQty,
    netRequiredQty: row.netRequiredQty,
    plannedStartDate: row.plannedStartDate ?? '',
    dueDate: row.dueDate,
    daysToDue: row.daysToDue,
    overdue: row.overdue,
    materialReady: row.materialReady ?? '',
    availableHours: row.availableHours,
    unitsPerHour: row.unitsPerHour,
    requiredHours: row.requiredHours,
    capacityGapHours: row.capacityGapHours,
    capacityChecked: row.capacityChecked,
    resultStatus: row.resultStatus,
    reason: row.reason,
    sourceFile: row.sourceFile,
    sourceSheet: row.sourceSheet,
    sourceRow: row.sourceRow,
    workflowVersion: row.workflowVersion,
    inputSha256: row.inputSha256,
    sourceTrace: row.sourceTrace,
  };
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
