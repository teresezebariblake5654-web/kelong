import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  countDistinct,
  detectDuplicateOrderLines,
  financialControlTotal,
  maskOrder,
  matchLiveSession,
  moneyAdd,
  moneyToFixed,
  normalizeMoney,
  normalizeOrderStatus,
  normalizePlatform,
  oversellQty,
  processingDays,
  sanitizeEcomSummary,
  skuNormalize,
  toDecimal,
} from '../operators/ecommerceCommon.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  buildRuleSnapshotRows,
} from '../operators/hrCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import { toLiveOrderRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const LIVE_ALIASES: FieldAliasMap = {
  platform: ['平台', 'platform'],
  liveSessionId: ['场次ID', '直播场次', 'live_session_id', 'liveSessionId', 'sessionId'],
  orderNo: ['订单号', 'order_no', 'orderNo'],
  lineItemId: ['行项目', 'line_item_id', 'lineItemId'],
  orderTime: ['下单时间', 'order_time', 'orderTime'],
  sku: ['SKU', 'sku', '商品编码'],
  qty: ['数量', 'qty'],
  paidAmount: ['实付', 'paid_amount', 'paidAmount'],
  orderStatus: ['订单状态', 'order_status', 'orderStatus', '状态'],
  host: ['主播', 'host'],
};

const INV_ALIASES: FieldAliasMap = {
  sku: ['SKU', 'sku'],
  availableQty: ['可售库存', '可用库存', 'available', 'availableQty', 'sellableQty'],
  sellableQty: ['可售', 'sellable', 'sellableQty'],
};

const PLAN_ALIASES: FieldAliasMap = {
  liveSessionId: ['场次ID', '直播场次', 'live_session_id', 'liveSessionId'],
  host: ['主播', 'host'],
  startTime: ['开始时间', 'start_time', 'startTime'],
  endTime: ['结束时间', 'end_time', 'endTime'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function isPaid(status: string): boolean {
  return status === 'PAID' || status === 'SHIPPED';
}

/** ECOM-LIVE-ORDER-004 — session rollup + oversell flags; never auto-cancels. */
export async function executeEcomLiveOrder(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('live_orders')) throw new Error('live_orders is required');
  const rules = toLiveOrderRules(ctx.companyRules);
  const orderDs = ctx.datasets.get('live_orders')!;
  const orders = normalizeColumns(orderDs.rows, LIVE_ALIASES, {
    role: 'live_orders',
    sourceFile: orderDs.fileName,
    sourceSheet: orderDs.sheetName,
    inputSha256: orderDs.sha256,
  });
  const invDs = ctx.datasets.get('inventory');
  const inventory = invDs
    ? normalizeColumns(invDs.rows, INV_ALIASES, {
        role: 'inventory',
        sourceFile: invDs.fileName,
        sourceSheet: invDs.sheetName,
        inputSha256: invDs.sha256,
      })
    : [];
  const planDs = ctx.datasets.get('live_plan');
  const plans = planDs
    ? normalizeColumns(planDs.rows, PLAN_ALIASES, {
        role: 'live_plan',
        sourceFile: planDs.fileName,
        sourceSheet: planDs.sheetName,
        inputSha256: planDs.sha256,
      })
    : [];

  const invBySku = new Map<string, DataRow>();
  for (const row of inventory) {
    const key = skuNormalize(row.sku);
    if (key) invBySku.set(key, row);
  }

  const dupGroups = detectDuplicateOrderLines(orders);
  const dupKeys = new Set(dupGroups.keys());
  const detail: DataRow[] = [];
  const paidQtyBySku = new Map<string, ReturnType<typeof toDecimal>>();

  for (const row of orders) {
    const codes: string[] = [];
    const platform = normalizePlatform(row.platform);
    const status = normalizeOrderStatus(row.orderStatus);
    const uniqueKey = `${platform}||${asText(row.orderNo)}||${asText(row.lineItemId) || `${skuNormalize(row.sku)}||${asText(row.qty)}||${asText(row.paidAmount)}`}`.toLowerCase();
    if (dupKeys.has(uniqueKey)) codes.push('DUPLICATE');

    if (hasBlank(row.orderNo) || hasBlank(row.sku)) codes.push('INVALID');
    const qty = normalizeMoney(row.qty);
    const paid = normalizeMoney(row.paidAmount);
    if (!qty.ok || !paid.ok) codes.push('INVALID');

    const session = matchLiveSession({
      liveSessionId: row.liveSessionId,
      orderTime: row.orderTime,
      sessions: plans,
      rule: rules.sessionMatchRule,
    });
    if (session.status === 'UNMATCHED' && plans.length > 0) codes.push('SESSION_UNMATCHED');
    if (session.status === 'AMBIGUOUS') codes.push('SESSION_AMBIGUOUS');

    if (status === 'UNPAID') {
      const days = processingDays(ctx.runDate, row.orderTime);
      if (days !== null && days * 24 * 60 > rules.cancelWindowMinutes) codes.push('UNPAID_OVERDUE');
      else codes.push('UNPAID');
    }
    if (status === 'CANCELLED' || status === 'REFUNDED') codes.push('CANCELLED_REFUNDED');

    const sku = skuNormalize(row.sku);
    if (isPaid(status) && qty.ok) {
      paidQtyBySku.set(sku, moneyAdd(paidQtyBySku.get(sku) ?? toDecimal(0), qty.value));
    }

    const orderTime = normalizeDate(row.orderTime);
    detail.push({
      platform,
      liveSessionId: session.sessionId || asText(row.liveSessionId),
      sessionMatch: session.status,
      host: session.host || asText(row.host),
      orderNo: asText(row.orderNo),
      orderNoMasked: maskOrder(row.orderNo),
      orderTime: orderTime.ok ? orderTime.value : asText(row.orderTime),
      sku,
      qty: qty.ok ? moneyToFixed(qty.value, 0) : asText(row.qty),
      paidAmount: paid.ok ? moneyToFixed(paid.value) : asText(row.paidAmount),
      orderStatus: status,
      exceptionCodes: codes.join('|'),
      status: codes.length ? 'NEEDS_REVIEW' : status === 'PAID' ? 'READY' : status,
      autoCancel: false,
      sourceTrace: traceOf(row),
    });

    for (const code of codes) {
      ctx.exceptions.push({ code, severity: 'WARNING', message: code, row });
    }
  }

  // Mark oversell after paid qty aggregation
  const oversellRows: DataRow[] = [];
  for (const row of detail) {
    const sku = asText(row.sku);
    const inv = invBySku.get(sku);
    const sellable = inv?.sellableQty ?? inv?.availableQty ?? 0;
    const paidQty = paidQtyBySku.get(sku) ?? toDecimal(0);
    const over = oversellQty(paidQty, sellable);
    if (over.gt(0) && isPaid(asText(row.orderStatus))) {
      row.oversellQty = moneyToFixed(over, 0);
      row.exceptionCodes = [asText(row.exceptionCodes), 'OVERSELL'].filter(Boolean).join('|');
      row.status = 'NEEDS_REVIEW';
      oversellRows.push(row);
      ctx.exceptions.push({
        code: 'OVERSELL',
        severity: 'BLOCKING',
        message: 'Oversell detected',
        row,
      });
    }
  }

  // Session / SKU summaries
  const sessionMap = new Map<string, { orders: Set<string>; qty: ReturnType<typeof toDecimal>; amount: ReturnType<typeof toDecimal> }>();
  const skuMap = new Map<string, { orders: Set<string>; qty: ReturnType<typeof toDecimal>; amount: ReturnType<typeof toDecimal>; sessionId: string }>();
  for (const row of detail) {
    const sid = asText(row.liveSessionId) || '(未匹配)';
    const s = sessionMap.get(sid) ?? { orders: new Set<string>(), qty: toDecimal(0), amount: toDecimal(0) };
    s.orders.add(asText(row.orderNo));
    const q = normalizeMoney(row.qty);
    const a = normalizeMoney(row.paidAmount);
    if (q.ok) s.qty = moneyAdd(s.qty, q.value);
    if (a.ok) s.amount = moneyAdd(s.amount, a.value);
    sessionMap.set(sid, s);

    const sku = asText(row.sku);
    const g = skuMap.get(sku) ?? {
      orders: new Set<string>(),
      qty: toDecimal(0),
      amount: toDecimal(0),
      sessionId: sid,
    };
    g.orders.add(asText(row.orderNo));
    if (q.ok) g.qty = moneyAdd(g.qty, q.value);
    if (a.ok) g.amount = moneyAdd(g.amount, a.value);
    skuMap.set(sku, g);
  }

  const sessionRows: DataRow[] = [...sessionMap.entries()].map(([id, v]) => ({
    liveSessionId: id,
    orderCount: v.orders.size,
    qty: moneyToFixed(v.qty, 0),
    paidAmount: moneyToFixed(v.amount),
  }));
  const skuRows: DataRow[] = [...skuMap.entries()].map(([sku, v]) => ({
    sku,
    liveSessionId: v.sessionId,
    orderCount: v.orders.size,
    qty: moneyToFixed(v.qty, 0),
    paidAmount: moneyToFixed(v.amount),
  }));

  const ready = detail.filter((r) => asText(r.status) === 'READY');
  const overdue = detail.filter((r) => asText(r.exceptionCodes).includes('UNPAID_OVERDUE'));
  const conflicts = detail.filter(
    (r) =>
      asText(r.exceptionCodes).includes('SESSION_AMBIGUOUS') ||
      asText(r.exceptionCodes).includes('CANCELLED'),
  );
  const mergeCandidates = detail.filter((r) => asText(r.exceptionCodes).includes('DUPLICATE'));

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '直播订单处理_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '待发货订单', rows: ready },
      { name: '直播场次汇总', rows: sessionRows },
      { name: '商品汇总', rows: skuRows },
      { name: '超卖订单', rows: oversellRows },
      { name: '超时未付', rows: overdue },
      { name: '异常订单', rows: detail.filter((r) => asText(r.status) === 'NEEDS_REVIEW') },
      { name: '状态冲突', rows: conflicts },
      { name: '合并候选', rows: mergeCandidates },
      { name: '规则快照', rows: buildRuleSnapshotRows(rules as unknown as Record<string, unknown>) },
      {
        name: '运行说明',
        rows: buildHrRunNotes({
          workflowId: definition.id,
          workflowVersion: ctx.workflowVersion,
          runDate: ctx.runDate,
          rules: rules as unknown as Record<string, unknown>,
          inputSha256ByRole: ctx.inputSha256ByRole,
          inputRowCount: orders.length,
          outputRowCount: detail.length,
          exceptionCount: ctx.exceptions.length,
          extras: [
            { key: 'orderCountDistinct', value: countDistinct(detail, 'orderNo') },
            { key: 'control.paidAmount', value: financialControlTotal(detail, 'paidAmount') },
            { key: 'autoCancel', value: false },
            { key: 'cloudUpload', value: false },
          ],
        }),
      },
    ],
  });

  const needsReview = detail.some((r) => asText(r.status) === 'NEEDS_REVIEW') || oversellRows.length > 0;
  ctx.metrics = {
    orderCount: countDistinct(detail, 'orderNo'),
    orderLineCount: detail.length,
    oversellCount: oversellRows.length,
    sessionCount: sessionRows.length,
    autoCancel: false,
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
