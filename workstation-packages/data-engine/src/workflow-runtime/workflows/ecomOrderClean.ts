import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  countDistinct,
  detectDuplicateOrderLines,
  financialControlTotal,
  hasRequiredAddress,
  isValidPhone,
  maskAddress,
  maskOrder,
  maskPhone,
  maskReceiverName,
  moneyAdd,
  moneyToFixed,
  normalizeFulfillmentStatus,
  normalizeMoney,
  normalizePaymentStatus,
  normalizePlatform,
  orderAmountDifference,
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
import { toOrderCleanRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const ORDER_ALIASES: FieldAliasMap = {
  platform: ['平台', 'platform', '渠道'],
  orderNo: ['订单号', 'order_no', 'orderNo', '订单编号'],
  lineItemId: ['行项目', '行号', 'line_item_id', 'lineItemId', '子订单号'],
  orderTime: ['下单时间', '订单时间', 'order_time', 'orderTime', 'date'],
  sku: ['SKU', 'sku', '商品编码', '货号'],
  qty: ['数量', 'qty', 'quantity'],
  itemAmount: ['行金额', '商品金额', 'item_amount', 'itemAmount', '成交金额'],
  orderAmount: ['订单金额', '应付金额', 'order_amount', 'orderAmount', '实付金额'],
  shippingAmount: ['运费', 'shipping', 'shippingAmount', '邮费'],
  discountAmount: ['优惠', '折扣', 'discount', 'discountAmount'],
  paymentStatus: ['支付状态', 'payment_status', 'paymentStatus', '付款状态'],
  fulfillmentStatus: ['发货状态', '履约状态', 'fulfillment_status', 'fulfillmentStatus'],
  receiverName: ['收货人', '收件人', 'receiver', 'receiverName', '姓名'],
  phone: ['手机', '电话', 'phone', 'mobile', '收货电话'],
  address: ['地址', '收货地址', 'address', '详细地址'],
  province: ['省', 'province'],
  city: ['市', 'city'],
};

const SKU_ALIASES: FieldAliasMap = {
  sku: ['SKU', 'sku', '商品编码'],
  productName: ['商品名称', '品名', 'product_name', 'productName', '名称'],
  status: ['状态', 'status', '上下架'],
  weight: ['重量', 'weight'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function pickStatus(codes: string[]): string {
  const order = [
    'INVALID',
    'DUPLICATE',
    'UNPAID',
    'UNKNOWN_SKU',
    'AMOUNT_MISMATCH',
    'ADDRESS_INVALID',
    'MISMATCH',
    'UNKNOWN',
  ];
  for (const code of order) if (codes.includes(code)) return code;
  return 'READY';
}

/** ECOM-ORDER-CLEAN-001 — suggest fulfillable orders only; never ships. */
export async function executeEcomOrderClean(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('orders')) throw new Error('orders is required');
  const rules = toOrderCleanRules(ctx.companyRules);
  const orderDs = ctx.datasets.get('orders')!;
  const orders = normalizeColumns(orderDs.rows, ORDER_ALIASES, {
    role: 'orders',
    sourceFile: orderDs.fileName,
    sourceSheet: orderDs.sheetName,
    inputSha256: orderDs.sha256,
  });
  const skuDs = ctx.datasets.get('sku_master');
  const skuRows = skuDs
    ? normalizeColumns(skuDs.rows, SKU_ALIASES, {
        role: 'sku_master',
        sourceFile: skuDs.fileName,
        sourceSheet: skuDs.sheetName,
        inputSha256: skuDs.sha256,
      })
    : [];
  const skuMap = new Map<string, DataRow>();
  for (const row of skuRows) {
    const key = skuNormalize(row.sku);
    if (key) skuMap.set(key, row);
  }

  const dupGroups = detectDuplicateOrderLines(orders);
  const dupKeys = new Set(dupGroups.keys());
  const tol = toDecimal(rules.amountTolerance);

  // Aggregate line amounts by platform+orderNo for amount checks
  const orderLineSum = new Map<string, ReturnType<typeof toDecimal>>();
  const orderMeta = new Map<string, DataRow>();
  for (const row of orders) {
    const platform = normalizePlatform(row.platform);
    const orderNo = asText(row.orderNo);
    const key = `${platform}||${orderNo}`.toLowerCase();
    const item = normalizeMoney(row.itemAmount);
    const prev = orderLineSum.get(key) ?? toDecimal(0);
    if (item.ok) orderLineSum.set(key, moneyAdd(prev, item.value));
    if (!orderMeta.has(key)) orderMeta.set(key, row);
  }

  const detail: DataRow[] = [];
  for (const row of orders) {
    const codes: string[] = [];
    const platform = normalizePlatform(row.platform);
    const orderNo = asText(row.orderNo);
    const orderKey = `${platform}||${orderNo}`.toLowerCase();
    const uniqueKey = orderLineUniqueKey({ ...row, platform });
    if (dupKeys.has(uniqueKey)) codes.push('DUPLICATE');

    if (hasBlank(row.orderNo) || hasBlank(row.sku)) codes.push('INVALID');
    const qty = normalizeMoney(row.qty);
    const itemAmount = normalizeMoney(row.itemAmount);
    if (!qty.ok || !itemAmount.ok) codes.push('INVALID');

    const payment = normalizePaymentStatus(row.paymentStatus);
    const fulfillment = normalizeFulfillmentStatus(row.fulfillmentStatus);
    if (payment === 'UNPAID') codes.push('UNPAID');
    if (payment === 'UNKNOWN') codes.push('UNKNOWN');

    const skuKey = skuNormalize(row.sku);
    const skuHit = skuMap.get(skuKey);
    if (skuRows.length > 0 && !skuHit) codes.push('UNKNOWN_SKU');

    const lineSum = orderLineSum.get(orderKey) ?? toDecimal(0);
    const amtCheck = orderAmountDifference({
      orderAmount: row.orderAmount,
      lineAmountSum: lineSum,
      shippingAmount: row.shippingAmount,
      discountAmount: row.discountAmount,
    });
    let amountDiff = '';
    if (!amtCheck.ok) {
      codes.push('INVALID');
    } else {
      amountDiff = moneyToFixed(amtCheck.difference);
      if (amtCheck.difference.abs().gt(tol)) codes.push('AMOUNT_MISMATCH');
    }

    const addressOk = hasRequiredAddress(row, rules.addressRequiredFields);
    const phoneOk = !asText(row.phone) || isValidPhone(row.phone);
    if (!addressOk || !phoneOk) codes.push('ADDRESS_INVALID');

    const orderTime = normalizeDate(row.orderTime);
    if (asText(row.orderTime) && !orderTime.ok) codes.push('INVALID');

    const status = pickStatus(codes);
    const displayPhone = rules.phoneMasking ? maskPhone(row.phone) : asText(row.phone);
    detail.push({
      platform,
      orderNo,
      orderNoMasked: maskOrder(orderNo),
      lineItemId: asText(row.lineItemId),
      orderTime: orderTime.ok ? orderTime.value : asText(row.orderTime),
      sku: skuKey,
      productName: asText(skuHit?.productName),
      qty: qty.ok ? moneyToFixed(qty.value, 0) : asText(row.qty),
      itemAmount: itemAmount.ok ? moneyToFixed(itemAmount.value) : asText(row.itemAmount),
      orderAmount: asText(row.orderAmount),
      shippingAmount: asText(row.shippingAmount),
      discountAmount: asText(row.discountAmount),
      amountDifference: amountDiff,
      paymentStatus: payment,
      fulfillmentStatus: fulfillment,
      receiverNameMasked: maskReceiverName(row.receiverName),
      phoneMasked: displayPhone,
      addressMasked: maskAddress(row.address),
      exceptionCodes: codes.join('|'),
      status,
      sourceTrace: traceOf(row),
    });

    for (const code of codes) {
      ctx.exceptions.push({
        code,
        severity: code === 'DUPLICATE' || code === 'AMOUNT_MISMATCH' ? 'WARNING' : 'BLOCKING',
        message: code,
        row,
      });
    }
  }

  const ready = detail.filter((r) => asText(r.status) === 'READY');
  const blocked = detail.filter((r) => !['READY', 'DUPLICATE'].includes(asText(r.status)));
  const duplicates = detail.filter((r) => asText(r.exceptionCodes).includes('DUPLICATE'));
  const unknownSku = detail.filter((r) => asText(r.exceptionCodes).includes('UNKNOWN_SKU'));
  const amountEx = detail.filter((r) => asText(r.exceptionCodes).includes('AMOUNT_MISMATCH'));
  const addressEx = detail.filter((r) => asText(r.exceptionCodes).includes('ADDRESS_INVALID'));

  const distinctOrders = countDistinct(detail, 'orderNo');
  const controlItemAmount = financialControlTotal(detail, 'itemAmount');

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '订单清洗结果_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '可发货订单', rows: ready },
      { name: '订单行明细', rows: detail },
      { name: '阻塞订单', rows: blocked },
      { name: '重复订单', rows: duplicates },
      { name: '未知SKU', rows: unknownSku },
      { name: '金额异常', rows: amountEx },
      { name: '地址异常', rows: addressEx },
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
            { key: 'orderCountDistinct', value: distinctOrders },
            { key: 'orderLineCount', value: detail.length },
            { key: 'control.itemAmount', value: controlItemAmount },
            { key: 'cloudUpload', value: false },
            { key: 'autoFulfill', value: false },
          ],
        }),
      },
    ],
  });

  const needsReview = detail.some((r) => asText(r.status) !== 'READY');
  ctx.metrics = {
    orderCount: distinctOrders,
    orderLineCount: detail.length,
    readyCount: ready.length,
    duplicateCount: duplicates.length,
    controlItemAmount,
    cloudUpload: false,
    autoFulfill: false,
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
      workflowVersion: ctx.workflowVersion,
      runId: ctx.runId,
      metrics: { ...ctx.metrics },
    }),
  };
}
