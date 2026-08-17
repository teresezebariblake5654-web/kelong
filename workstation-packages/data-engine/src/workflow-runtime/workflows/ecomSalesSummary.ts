import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  averageOrderValue,
  countDistinct,
  financialPeriod,
  moneyAdd,
  moneyMul,
  moneySub,
  moneyToFixed,
  normalizeMoney,
  normalizePlatform,
  orderLineUniqueKey,
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
import { toSalesSummaryRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const SALES_ALIASES: FieldAliasMap = {
  orderNo: ['订单号', 'order_no', 'orderNo'],
  lineItemId: ['行项目', 'line_item_id', 'lineItemId'],
  date: ['日期', 'date', '订单日期'],
  platform: ['平台', 'platform'],
  shop: ['店铺', 'shop', 'store'],
  channel: ['渠道', 'channel'],
  sku: ['SKU', 'sku', '商品编码'],
  qty: ['数量', 'qty'],
  grossSales: ['毛销售', '销售额', 'gross_sales', 'grossSales', '成交金额'],
  discount: ['折扣', '优惠', 'discount'],
  shipping: ['运费', 'shipping'],
  tax: ['税', 'tax'],
};

const REFUND_ALIASES: FieldAliasMap = {
  orderNo: ['订单号', 'order_no', 'orderNo'],
  refundAmount: ['退款金额', 'refund_amount', 'refundAmount'],
  refundDate: ['退款日期', 'refund_date', 'refundDate', 'date'],
  sku: ['SKU', 'sku'],
};

const COST_ALIASES: FieldAliasMap = {
  sku: ['SKU', 'sku'],
  unitCost: ['单位成本', '成本', 'unit_cost', 'unitCost', 'cost'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

/** ECOM-SALES-SUMMARY-005 — multi-dimension rollup with control totals. */
export async function executeEcomSalesSummary(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('sales_orders')) throw new Error('sales_orders is required');
  const rules = toSalesSummaryRules(ctx.companyRules);
  const salesDs = ctx.datasets.get('sales_orders')!;
  const sales = normalizeColumns(salesDs.rows, SALES_ALIASES, {
    role: 'sales_orders',
    sourceFile: salesDs.fileName,
    sourceSheet: salesDs.sheetName,
    inputSha256: salesDs.sha256,
  });
  const refundDs = ctx.datasets.get('refunds');
  const refunds = refundDs
    ? normalizeColumns(refundDs.rows, REFUND_ALIASES, {
        role: 'refunds',
        sourceFile: refundDs.fileName,
        sourceSheet: refundDs.sheetName,
        inputSha256: refundDs.sha256,
      })
    : [];
  const costDs = ctx.datasets.get('product_cost');
  const costs = costDs
    ? normalizeColumns(costDs.rows, COST_ALIASES, {
        role: 'product_cost',
        sourceFile: costDs.fileName,
        sourceSheet: costDs.sheetName,
        inputSha256: costDs.sha256,
      })
    : [];

  const costBySku = new Map<string, ReturnType<typeof toDecimal>>();
  for (const row of costs) {
    const key = skuNormalize(row.sku);
    const c = normalizeMoney(row.unitCost);
    if (key && c.ok) costBySku.set(key, c.value);
  }

  // Refund attribution: default ORDER_DATE → attribute to order's date via orderNo sum
  const refundByOrder = new Map<string, ReturnType<typeof toDecimal>>();
  for (const row of refunds) {
    const key = asText(row.orderNo).toLowerCase();
    const amt = normalizeMoney(row.refundAmount);
    if (!key || !amt.ok) continue;
    refundByOrder.set(key, moneyAdd(refundByOrder.get(key) ?? toDecimal(0), amt.value));
  }

  const lineKeyCounts = new Map<string, number>();
  for (const row of sales) {
    const key = orderLineUniqueKey(row);
    lineKeyCounts.set(key, (lineKeyCounts.get(key) ?? 0) + 1);
  }
  const lines: DataRow[] = [];
  let grossTotal = toDecimal(0);
  let discountTotal = toDecimal(0);
  let refundTotal = toDecimal(0);
  let netTotal = toDecimal(0);
  let costTotal = toDecimal(0);
  let qtyTotal = toDecimal(0);

  // Allocate order-level refunds proportionally across lines later; first pass compute line nets
  const orderGross = new Map<string, ReturnType<typeof toDecimal>>();
  for (const row of sales) {
    const orderNo = asText(row.orderNo).toLowerCase();
    const g = normalizeMoney(row.grossSales);
    if (orderNo && g.ok) orderGross.set(orderNo, moneyAdd(orderGross.get(orderNo) ?? toDecimal(0), g.value));
  }

  for (const row of sales) {
    const codes: string[] = [];
    const platform = normalizePlatform(row.platform);
    const orderNo = asText(row.orderNo);
    if (hasBlank(orderNo) || hasBlank(row.sku)) codes.push('INVALID');
    const uniqueKey = orderLineUniqueKey({ ...row, platform });
    if ((lineKeyCounts.get(uniqueKey) ?? 0) > 1) codes.push('DUPLICATE');

    const gross = normalizeMoney(row.grossSales);
    const discount = normalizeMoney(row.discount ?? 0);
    const qty = normalizeMoney(row.qty);
    if (!gross.ok || !qty.ok) codes.push('INVALID');

    const orderKey = orderNo.toLowerCase();
    const orderRefund = refundByOrder.get(orderKey) ?? toDecimal(0);
    const og = orderGross.get(orderKey) ?? toDecimal(0);
    let lineRefund = toDecimal(0);
    if (gross.ok && og.gt(0) && orderRefund.gt(0)) {
      lineRefund = moneyMul(orderRefund, moneyDivSafe(gross.value, og));
    }

    const disc = discount.ok ? discount.value : toDecimal(0);
    const net = gross.ok ? moneySub(moneySub(gross.value, disc), lineRefund) : toDecimal(0);
    if (net.lt(0)) codes.push('NEGATIVE_NET');

    const sku = skuNormalize(row.sku);
    const unitCost = costBySku.get(sku);
    if (!unitCost && costs.length > 0) codes.push('MISSING_COST');
    const lineCost =
      unitCost && qty.ok ? moneyMul(unitCost, qty.value) : toDecimal(0);
    const profit = moneySub(net, lineCost);

    const date = normalizeDate(row.date);
    const period = financialPeriod(
      date.ok ? date.value : ctx.runDate,
      rules.period === 'WEEK' ? 'WEEK' : 'MONTH',
    );

    if (gross.ok) grossTotal = moneyAdd(grossTotal, gross.value);
    discountTotal = moneyAdd(discountTotal, disc);
    refundTotal = moneyAdd(refundTotal, lineRefund);
    netTotal = moneyAdd(netTotal, net);
    costTotal = moneyAdd(costTotal, lineCost);
    if (qty.ok) qtyTotal = moneyAdd(qtyTotal, qty.value);

    lines.push({
      orderNo,
      platform,
      shop: asText(row.shop),
      channel: asText(row.channel) || asText(row.shop) || platform,
      sku,
      date: date.ok ? date.value : asText(row.date),
      period,
      qty: qty.ok ? moneyToFixed(qty.value, 0) : asText(row.qty),
      grossSales: gross.ok ? moneyToFixed(gross.value) : '',
      discount: moneyToFixed(disc),
      refundAmount: moneyToFixed(lineRefund),
      netSales: moneyToFixed(net),
      unitCost: unitCost ? moneyToFixed(unitCost) : '',
      productCost: moneyToFixed(lineCost),
      grossProfit: moneyToFixed(profit),
      exceptionCodes: codes.join('|'),
      status: codes.length ? 'NEEDS_REVIEW' : 'READY',
      sourceTrace: traceOf(row),
    });

    for (const code of codes) {
      ctx.exceptions.push({ code, severity: 'WARNING', message: code, row });
    }
  }

  const orderCount = countDistinct(lines, 'orderNo');
  const aov = averageOrderValue(netTotal, orderCount);
  const controlNet = moneyToFixed(moneySub(moneySub(grossTotal, discountTotal), refundTotal));
  const netFixed = moneyToFixed(netTotal);
  const controlOk = controlNet === netFixed;

  if (!controlOk) {
    ctx.exceptions.push({
      code: 'CONTROL_TOTAL_MISMATCH',
      severity: 'BLOCKING',
      message: `Control net ${controlNet} !== rolled net ${netFixed}`,
    });
  }

  function rollup(groupKeys: string[]): DataRow[] {
    const map = new Map<string, {
      orders: Set<string>;
      qty: ReturnType<typeof toDecimal>;
      gross: ReturnType<typeof toDecimal>;
      discount: ReturnType<typeof toDecimal>;
      refund: ReturnType<typeof toDecimal>;
      net: ReturnType<typeof toDecimal>;
      cost: ReturnType<typeof toDecimal>;
      profit: ReturnType<typeof toDecimal>;
      dims: Record<string, string>;
    }>();
    for (const row of lines) {
      const dims: Record<string, string> = {};
      for (const k of groupKeys) dims[k] = asText(row[k]) || '(空白)';
      const key = groupKeys.map((k) => dims[k]).join('||');
      const prev = map.get(key) ?? {
        orders: new Set<string>(),
        qty: toDecimal(0),
        gross: toDecimal(0),
        discount: toDecimal(0),
        refund: toDecimal(0),
        net: toDecimal(0),
        cost: toDecimal(0),
        profit: toDecimal(0),
        dims,
      };
      prev.orders.add(asText(row.orderNo));
      const q = normalizeMoney(row.qty);
      const g = normalizeMoney(row.grossSales);
      const d = normalizeMoney(row.discount);
      const r = normalizeMoney(row.refundAmount);
      const n = normalizeMoney(row.netSales);
      const c = normalizeMoney(row.productCost);
      const p = normalizeMoney(row.grossProfit);
      if (q.ok) prev.qty = moneyAdd(prev.qty, q.value);
      if (g.ok) prev.gross = moneyAdd(prev.gross, g.value);
      if (d.ok) prev.discount = moneyAdd(prev.discount, d.value);
      if (r.ok) prev.refund = moneyAdd(prev.refund, r.value);
      if (n.ok) prev.net = moneyAdd(prev.net, n.value);
      if (c.ok) prev.cost = moneyAdd(prev.cost, c.value);
      if (p.ok) prev.profit = moneyAdd(prev.profit, p.value);
      map.set(key, prev);
    }
    return [...map.values()].map((v) => ({
      ...v.dims,
      orderCount: v.orders.size,
      qty: moneyToFixed(v.qty, 0),
      grossSales: moneyToFixed(v.gross),
      discount: moneyToFixed(v.discount),
      refundAmount: moneyToFixed(v.refund),
      netSales: moneyToFixed(v.net),
      averageOrderValue: averageOrderValue(v.net, v.orders.size),
      productCost: moneyToFixed(v.cost),
      grossProfit: moneyToFixed(v.profit),
    }));
  }

  const overview: DataRow[] = [
    {
      period: financialPeriod(ctx.runDate, rules.period === 'WEEK' ? 'WEEK' : 'MONTH'),
      orderCount,
      orderLineCount: lines.length,
      qty: moneyToFixed(qtyTotal, 0),
      grossSales: moneyToFixed(grossTotal),
      discount: moneyToFixed(discountTotal),
      refundAmount: moneyToFixed(refundTotal),
      netSales: netFixed,
      averageOrderValue: aov,
      productCost: moneyToFixed(costTotal),
      grossProfit: moneyToFixed(moneySub(netTotal, costTotal)),
      controlBalanced: controlOk,
    },
  ];

  const period = financialPeriod(ctx.runDate, rules.period === 'WEEK' ? 'WEEK' : 'MONTH');
  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '电商销售汇总_{period}.xlsx',
    { period, runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '销售总览', rows: overview },
      { name: '平台汇总', rows: rollup(['platform', 'shop']) },
      { name: '商品排行', rows: rollup(['sku']) },
      { name: '渠道汇总', rows: rollup(['channel']) },
      { name: '退款分析', rows: rollup(['platform']).map((r) => ({ ...r, focus: 'refund' })) },
      { name: '毛利分析', rows: rollup(['sku']) },
      { name: '趋势', rows: rollup(['period', 'date']) },
      { name: '数据异常', rows: lines.filter((r) => asText(r.status) !== 'READY') },
      { name: '规则快照', rows: buildRuleSnapshotRows(rules as unknown as Record<string, unknown>) },
      {
        name: '运行说明',
        rows: buildHrRunNotes({
          workflowId: definition.id,
          workflowVersion: ctx.workflowVersion,
          runDate: ctx.runDate,
          rules: rules as unknown as Record<string, unknown>,
          inputSha256ByRole: ctx.inputSha256ByRole,
          inputRowCount: sales.length,
          outputRowCount: lines.length,
          exceptionCount: ctx.exceptions.length,
          extras: [
            { key: 'control.netSales', value: controlNet },
            { key: 'rolled.netSales', value: netFixed },
            { key: 'controlBalanced', value: controlOk },
            { key: 'orderCountDistinct', value: orderCount },
            { key: 'cloudUpload', value: false },
          ],
        }),
      },
    ],
  });

  const needsReview = !controlOk || lines.some((r) => asText(r.status) !== 'READY');
  ctx.metrics = {
    orderCount,
    orderLineCount: lines.length,
    netSales: netFixed,
    grossSales: moneyToFixed(grossTotal),
    refundAmount: moneyToFixed(refundTotal),
    averageOrderValue: aov,
    controlBalanced: controlOk,
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

function moneyDivSafe(a: ReturnType<typeof toDecimal>, b: ReturnType<typeof toDecimal>) {
  if (b.isZero()) return toDecimal(0);
  return a.div(b);
}
