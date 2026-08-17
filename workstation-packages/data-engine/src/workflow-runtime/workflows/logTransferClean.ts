import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  buildRuleSnapshotRows,
} from '../operators/hrCommon.js';
import {
  countDistinct,
  daysSince,
  exceedsQtyTolerance,
  formatQty,
  normalizeDate,
  normalizeSku,
  normalizeTransferStatus,
  normalizeWarehouse,
  qtyDiff,
  sanitizeLogSummary,
} from '../operators/logisticsCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { toLogTransferRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const TRANSFER_ALIASES: FieldAliasMap = {
  transferNo: ['调拨单号', 'transferNo', 'transfer_no', '单号'],
  fromWarehouse: ['调出仓', 'fromWarehouse', 'from_warehouse', '发货仓'],
  toWarehouse: ['调入仓', 'toWarehouse', 'to_warehouse', '收货仓'],
  sku: ['SKU', 'sku', '商品编码', '物料编码', '货号'],
  qty: ['数量', 'qty', 'quantity', '调拨数量'],
  receivedQty: ['实收数量', 'receivedQty', 'received_qty', '收货数量'],
  status: ['状态', 'status'],
  shipDate: ['发运日期', 'shipDate', 'ship_date', '发货日期'],
};

const WH_ALIASES: FieldAliasMap = {
  warehouse: ['仓库', 'warehouse', '仓码'],
  warehouseName: ['仓库名称', 'warehouseName', 'name'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

/** LOG-TRANSFER-CLEAN-005 — organize transfer exceptions; never auto-completes. */
export async function executeLogTransferClean(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('transfers')) throw new Error('transfers is required');
  const rules = toLogTransferRules(ctx.companyRules);
  const trDs = ctx.datasets.get('transfers')!;
  const transfers = normalizeColumns(trDs.rows, TRANSFER_ALIASES, {
    role: 'transfers',
    sourceFile: trDs.fileName,
    sourceSheet: trDs.sheetName,
    inputSha256: trDs.sha256,
  });
  const whDs = ctx.datasets.get('warehouses');
  const warehouses = whDs
    ? normalizeColumns(whDs.rows, WH_ALIASES, {
        role: 'warehouses',
        sourceFile: whDs.fileName,
        sourceSheet: whDs.sheetName,
        inputSha256: whDs.sha256,
      })
    : [];
  const knownWh = new Set(warehouses.map((w) => normalizeWarehouse(w.warehouse)).filter(Boolean));

  const detail: DataRow[] = [];
  for (const row of transfers) {
    const codes: string[] = [];
    const status = normalizeTransferStatus(row.status);
    const from = normalizeWarehouse(row.fromWarehouse);
    const to = normalizeWarehouse(row.toWarehouse);
    if (hasBlank(row.transferNo) || hasBlank(row.sku) || hasBlank(row.qty)) codes.push('INVALID');
    if (from && to && from === to) codes.push('INVALID');
    if (knownWh.size > 0) {
      if (from && !knownWh.has(from)) codes.push('UNKNOWN_WAREHOUSE');
      if (to && !knownWh.has(to)) codes.push('UNKNOWN_WAREHOUSE');
    }

    const shipDate = normalizeDate(row.shipDate);
    let daysInTransit: number | '' = '';
    if (shipDate.ok && (status === 'IN_TRANSIT' || status === 'PENDING_RECEIVE')) {
      const days = daysSince(ctx.runDate, row.shipDate);
      if (days !== null) {
        daysInTransit = days;
        if (days > rules.inTransitDays) codes.push('IN_TRANSIT_TIMEOUT');
      }
    }

    const receivedRaw = asText(row.receivedQty);
    let qtyDiffStr = '';
    if (receivedRaw) {
      const diff = qtyDiff(row.receivedQty, row.qty);
      if (Number.isFinite(diff)) {
        qtyDiffStr = formatQty(diff);
        if (exceedsQtyTolerance(diff, rules.qtyTolerance)) codes.push('QTY_EXCEPTION');
      }
    }

    if (status === 'PENDING_RECEIVE') codes.push('PENDING_RECEIVE');

    let bucket = 'OK';
    if (codes.includes('IN_TRANSIT_TIMEOUT')) bucket = 'IN_TRANSIT_TIMEOUT';
    else if (codes.includes('QTY_EXCEPTION')) bucket = 'QTY_EXCEPTION';
    else if (codes.includes('PENDING_RECEIVE') || status === 'PENDING_RECEIVE') bucket = 'PENDING_RECEIVE';
    else if (codes.length) bucket = 'EXCEPTION';

    detail.push({
      transferNo: asText(row.transferNo),
      fromWarehouse: from,
      toWarehouse: to,
      sku: normalizeSku(row.sku),
      qty: asText(row.qty),
      receivedQty: receivedRaw,
      qtyDifference: qtyDiffStr,
      status,
      shipDate: shipDate.ok ? shipDate.value : asText(row.shipDate),
      daysInTransit,
      exceptionCodes: [...new Set(codes)].join('|'),
      bucket,
      reviewStatus: codes.length ? 'NEEDS_REVIEW' : 'OK',
      sourceTrace: traceOf(row),
    });

    for (const code of [...new Set(codes)]) {
      ctx.exceptions.push({ code, severity: 'WARNING', message: code, row });
    }
  }

  const timeout = detail.filter((r) => asText(r.bucket) === 'IN_TRANSIT_TIMEOUT');
  const qtyEx = detail.filter((r) => asText(r.bucket) === 'QTY_EXCEPTION');
  const pending = detail.filter((r) => asText(r.bucket) === 'PENDING_RECEIVE');

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '调拨整理_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '调拨总表', rows: detail },
      { name: '在途超时', rows: timeout },
      { name: '数量异常', rows: qtyEx },
      { name: '待收货', rows: pending },
      { name: '规则快照', rows: buildRuleSnapshotRows(rules as unknown as Record<string, unknown>) },
      {
        name: '运行说明',
        rows: buildHrRunNotes({
          workflowId: definition.id,
          workflowVersion: ctx.workflowVersion,
          runDate: ctx.runDate,
          rules: rules as unknown as Record<string, unknown>,
          inputSha256ByRole: ctx.inputSha256ByRole,
          inputRowCount: transfers.length,
          outputRowCount: detail.length,
          exceptionCount: ctx.exceptions.length,
          extras: [
            { key: 'transferCount', value: countDistinct(detail, 'transferNo') },
            { key: 'cloudUpload', value: false },
            { key: 'autoCompleteTransfer', value: false },
            { key: 'autoAdjustStock', value: false },
          ],
        }),
      },
    ],
  });

  const needsReview = detail.some((r) => asText(r.reviewStatus) === 'NEEDS_REVIEW');
  ctx.metrics = {
    transferCount: countDistinct(detail, 'transferNo'),
    timeoutCount: timeout.length,
    qtyExceptionCount: qtyEx.length,
    pendingReceiveCount: pending.length,
    cloudUpload: false,
    autoCompleteTransfer: false,
    autoAdjustStock: false,
  };

  return {
    runId: ctx.runId,
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    status: needsReview ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath],
    metrics: ctx.metrics,
    exceptions: aggregateExceptionCounts(ctx.exceptions),
    aiSummaryPayload: sanitizeLogSummary({
      workflowId: definition.id,
      runId: ctx.runId,
      metrics: { ...ctx.metrics },
    }),
  };
}
