import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  financialControlTotal,
  maskOrder,
  moneyAdd,
  moneyToFixed,
  normalizeFulfillmentStatus,
  normalizeMoney,
  normalizePlatform,
  processingDays,
  refundRemaining,
  sanitizeEcomSummary,
  toDecimal,
} from '../operators/ecommerceCommon.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  buildRuleSnapshotRows,
  detectDuplicateKeys,
} from '../operators/hrCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { toRefundRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const ORDER_ALIASES: FieldAliasMap = {
  orderNo: ['订单号', 'order_no', 'orderNo'],
  paidAmount: ['实付', '已付金额', 'paid_amount', 'paidAmount', '支付金额'],
  paymentMethod: ['支付方式', 'payment_method', 'paymentMethod'],
  fulfillmentStatus: ['发货状态', '履约状态', 'fulfillment_status', 'fulfillmentStatus'],
  platform: ['平台', 'platform'],
};

const REFUND_ALIASES: FieldAliasMap = {
  refundNo: ['退款单号', 'refund_no', 'refundNo'],
  orderNo: ['订单号', 'order_no', 'orderNo'],
  refundAmount: ['退款金额', 'refund_amount', 'refundAmount'],
  refundTime: ['退款时间', '申请时间', 'refund_time', 'refundTime'],
  refundStatus: ['退款状态', 'refund_status', 'refundStatus'],
  refundReason: ['退款原因', '原因', 'refund_reason', 'refundReason'],
  completedTime: ['完成时间', 'completed_time', 'completedTime'],
};

const RETURN_ALIASES: FieldAliasMap = {
  returnNo: ['退货单号', 'return_no', 'returnNo'],
  orderNo: ['订单号', 'order_no', 'orderNo'],
  sku: ['SKU', 'sku'],
  returnQty: ['退货数量', 'return_qty', 'returnQty'],
  restockStatus: ['入库状态', 'restock_status', 'restockStatus'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function restocked(value: unknown): boolean {
  const t = asText(value).toLowerCase();
  return ['已入库', 'restocked', 'done', 'yes', '是', '1'].includes(t);
}

/** ECOM-REFUND-002 — verify only; never executes refunds. */
export async function executeEcomRefund(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('orders')) throw new Error('orders is required');
  if (!ctx.datasets.get('refunds')) throw new Error('refunds is required');
  const rules = toRefundRules(ctx.companyRules);
  const orderDs = ctx.datasets.get('orders')!;
  const refundDs = ctx.datasets.get('refunds')!;
  const orders = normalizeColumns(orderDs.rows, ORDER_ALIASES, {
    role: 'orders',
    sourceFile: orderDs.fileName,
    sourceSheet: orderDs.sheetName,
    inputSha256: orderDs.sha256,
  });
  const refunds = normalizeColumns(refundDs.rows, REFUND_ALIASES, {
    role: 'refunds',
    sourceFile: refundDs.fileName,
    sourceSheet: refundDs.sheetName,
    inputSha256: refundDs.sha256,
  });
  const returnDs = ctx.datasets.get('returns');
  const returns = returnDs
    ? normalizeColumns(returnDs.rows, RETURN_ALIASES, {
        role: 'returns',
        sourceFile: returnDs.fileName,
        sourceSheet: returnDs.sheetName,
        inputSha256: returnDs.sha256,
      })
    : [];

  const orderByNo = new Map<string, DataRow>();
  for (const row of orders) {
    const key = asText(row.orderNo).toLowerCase();
    if (key) orderByNo.set(key, row);
  }

  const refundsByOrder = new Map<string, DataRow[]>();
  for (const row of refunds) {
    const key = asText(row.orderNo).toLowerCase();
    const list = refundsByOrder.get(key) ?? [];
    list.push(row);
    refundsByOrder.set(key, list);
  }

  const returnsByOrder = new Map<string, DataRow[]>();
  for (const row of returns) {
    const key = asText(row.orderNo).toLowerCase();
    const list = returnsByOrder.get(key) ?? [];
    list.push(row);
    returnsByOrder.set(key, list);
  }

  const dupRefundNos = new Set(
    detectDuplicateKeys(refunds, ['refundNo']).map((g) => g.key),
  );

  const allowReasons = new Set(rules.allowNoReturnReasons.map((r) => r.toLowerCase()));
  const tol = toDecimal(rules.amountTolerance);
  const summary: DataRow[] = [];

  // Cumulative refund by order — never judge line-by-line for over-refund
  for (const [orderKey, orderRefunds] of refundsByOrder) {
    const order = orderByNo.get(orderKey);
    const paid = normalizeMoney(order?.paidAmount);
    let totalRefunded = toDecimal(0);
    for (const r of orderRefunds) {
      const amt = normalizeMoney(r.refundAmount);
      if (amt.ok) totalRefunded = moneyAdd(totalRefunded, amt.value);
    }
    const remaining = paid.ok
      ? refundRemaining(paid.value, totalRefunded)
      : ({ ok: false as const, reason: 'MISSING_PAID' });
    const orderReturns = returnsByOrder.get(orderKey) ?? [];
    const hasRestock = orderReturns.some((r) => restocked(r.restockStatus));
    const hasReturn = orderReturns.length > 0;

    for (const row of orderRefunds) {
      const codes: string[] = [];
      if (hasBlank(row.refundNo) || hasBlank(row.orderNo)) codes.push('INVALID');
      if (dupRefundNos.has(asText(row.refundNo).toLowerCase())) codes.push('DUPLICATE');

      const amt = normalizeMoney(row.refundAmount);
      if (!amt.ok) codes.push('INVALID');

      if (remaining.ok && remaining.overRefund.gt(tol)) codes.push('OVER_REFUND');

      const reason = asText(row.refundReason).toLowerCase();
      const allowOnlyRefund = allowReasons.has(reason);
      const fulfillment = normalizeFulfillmentStatus(order?.fulfillmentStatus);
      if (rules.requireRestock && !allowOnlyRefund && fulfillment === 'SHIPPED' && !hasRestock) {
        codes.push('NO_RESTOCK');
      }
      if (allowOnlyRefund && !hasReturn) codes.push('REFUND_ONLY');

      if (hasRestock && asText(row.refundStatus).toLowerCase().includes('待') ) {
        codes.push('RESTOCKED_NOT_REFUNDED');
      }

      const days = processingDays(ctx.runDate, row.refundTime, row.completedTime);
      if (days !== null && days > rules.maxProcessingDays) codes.push('OVERDUE');

      if (!order) codes.push('ORDER_MISSING');

      let status = 'READY';
      if (codes.length) status = codes.includes('OVER_REFUND') ? 'OVER_REFUND' : 'NEEDS_REVIEW';

      summary.push({
        platform: normalizePlatform(order?.platform),
        orderNo: asText(row.orderNo),
        orderNoMasked: maskOrder(row.orderNo),
        refundNo: asText(row.refundNo),
        refundAmount: amt.ok ? moneyToFixed(amt.value) : asText(row.refundAmount),
        totalRefunded: moneyToFixed(totalRefunded),
        paidAmount: paid.ok ? moneyToFixed(paid.value) : '',
        refundableRemaining: remaining.ok ? moneyToFixed(remaining.remaining) : '',
        overRefundAmount: remaining.ok ? moneyToFixed(remaining.overRefund) : '',
        processingDays: days ?? '',
        refundReason: asText(row.refundReason),
        refundStatus: asText(row.refundStatus),
        hasReturn,
        hasRestock,
        exceptionCodes: codes.join('|'),
        status,
        autoRefund: false,
        sourceTrace: traceOf(row),
      });

      for (const code of codes) {
        ctx.exceptions.push({
          code,
          severity: code === 'OVER_REFUND' || code === 'DUPLICATE' ? 'BLOCKING' : 'WARNING',
          message: code,
          row,
        });
      }
    }

    // Restocked but no refund rows for this order
    if (hasRestock && orderRefunds.length === 0) {
      const row = orderReturns[0]!;
      summary.push({
        orderNo: asText(row.orderNo),
        orderNoMasked: maskOrder(row.orderNo),
        refundNo: '',
        totalRefunded: '0.00',
        exceptionCodes: 'RESTOCKED_NOT_REFUNDED',
        status: 'NEEDS_REVIEW',
        autoRefund: false,
        sourceTrace: traceOf(row),
      });
      ctx.exceptions.push({
        code: 'RESTOCKED_NOT_REFUNDED',
        severity: 'WARNING',
        message: 'Restocked but not refunded',
        row,
      });
    }
  }

  const overDup = summary.filter(
    (r) =>
      asText(r.exceptionCodes).includes('OVER_REFUND') ||
      asText(r.exceptionCodes).includes('DUPLICATE'),
  );
  const noRestock = summary.filter((r) => asText(r.exceptionCodes).includes('NO_RESTOCK'));
  const notRefunded = summary.filter((r) =>
    asText(r.exceptionCodes).includes('RESTOCKED_NOT_REFUNDED'),
  );
  const overdue = summary.filter((r) => asText(r.exceptionCodes).includes('OVERDUE'));
  const refundOnly = summary.filter((r) => asText(r.exceptionCodes).includes('REFUND_ONLY'));
  const conflicts = summary.filter(
    (r) =>
      asText(r.exceptionCodes).includes('ORDER_MISSING') ||
      asText(r.exceptionCodes).includes('INVALID'),
  );

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '退款异常核对_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '退款总表', rows: summary },
      { name: '超额重复退款', rows: overDup },
      { name: '退货未入库', rows: noRestock },
      { name: '已入库未退款', rows: notRefunded },
      { name: '退款超时', rows: overdue },
      { name: '仅退款核对', rows: refundOnly },
      { name: '状态冲突', rows: conflicts },
      { name: '规则快照', rows: buildRuleSnapshotRows(rules as unknown as Record<string, unknown>) },
      {
        name: '运行说明',
        rows: buildHrRunNotes({
          workflowId: definition.id,
          workflowVersion: ctx.workflowVersion,
          runDate: ctx.runDate,
          rules: rules as unknown as Record<string, unknown>,
          inputSha256ByRole: ctx.inputSha256ByRole,
          inputRowCount: orders.length + refunds.length,
          outputRowCount: summary.length,
          exceptionCount: ctx.exceptions.length,
          extras: [
            { key: 'control.totalRefunded', value: financialControlTotal(summary, 'refundAmount') },
            { key: 'autoRefund', value: false },
            { key: 'cloudUpload', value: false },
          ],
        }),
      },
    ],
  });

  const needsReview = summary.some((r) => asText(r.status) !== 'READY');
  ctx.metrics = {
    refundRowCount: summary.length,
    overRefundCount: overDup.length,
    overdueCount: overdue.length,
    controlRefundAmount: financialControlTotal(summary, 'refundAmount'),
    autoRefund: false,
    cloudUpload: false,
  };

  return {
    runId: ctx.runId,
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    status: needsReview ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath],
    metrics: ctx.metrics,
    exceptions: aggregateExceptionCounts(ctx.exceptions),
    aiSummaryPayload: sanitizeEcomSummary({
      workflowId: definition.id,
      runId: ctx.runId,
      metrics: { ...ctx.metrics },
    }),
  };
}
