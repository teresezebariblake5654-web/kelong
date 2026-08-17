import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  daysOfInventory,
  financialControlTotal,
  grossMargin,
  inventoryOnHand,
  moneyAdd,
  moneyDiv,
  moneyToFixed,
  normalizeMoney,
  sanitizeEcomSummary,
  skuNormalize,
  toDecimal,
} from '../operators/ecommerceCommon.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  buildRuleSnapshotRows,
  detectDuplicateKeys,
} from '../operators/hrCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { daysBetween } from '../operators/dateWindow.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import { toProductDataRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const PRODUCT_ALIASES: FieldAliasMap = {
  productId: ['商品ID', 'product_id', 'productId', 'SPU'],
  sku: ['SKU', 'sku', '商品编码'],
  productName: ['商品名称', '品名', 'product_name', 'productName', '名称'],
  price: ['售价', '价格', 'price', 'salePrice'],
  cost: ['成本', '成本价', 'cost', 'unitCost'],
  status: ['状态', 'status', '上下架'],
  imageUrl: ['图片', '主图', 'image', 'imageUrl'],
  category: ['类目', 'category'],
  brand: ['品牌', 'brand'],
};

const INV_ALIASES: FieldAliasMap = {
  sku: ['SKU', 'sku', '商品编码'],
  availableQty: ['可用库存', '库存', 'available', 'availableQty', 'qty'],
  reservedQty: ['预留', '锁定', 'reserved', 'reservedQty'],
  inventoryValue: ['库存金额', 'inventory_value', 'inventoryValue'],
};

const SALES_ALIASES: FieldAliasMap = {
  date: ['日期', 'date', '销售日期'],
  sku: ['SKU', 'sku'],
  salesQty: ['销量', '销售数量', 'sales_qty', 'salesQty', 'qty'],
  salesAmount: ['销售额', 'sales_amount', 'salesAmount', 'amount'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

/** ECOM-PRODUCT-DATA-003 — diagnose only; never edits listings. */
export async function executeEcomProductData(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('products')) throw new Error('products is required');
  const rules = toProductDataRules(ctx.companyRules);
  const productDs = ctx.datasets.get('products')!;
  const products = normalizeColumns(productDs.rows, PRODUCT_ALIASES, {
    role: 'products',
    sourceFile: productDs.fileName,
    sourceSheet: productDs.sheetName,
    inputSha256: productDs.sha256,
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
  const salesDs = ctx.datasets.get('sales');
  const sales = salesDs
    ? normalizeColumns(salesDs.rows, SALES_ALIASES, {
        role: 'sales',
        sourceFile: salesDs.fileName,
        sourceSheet: salesDs.sheetName,
        inputSha256: salesDs.sha256,
      })
    : [];

  const invBySku = new Map<string, DataRow>();
  for (const row of inventory) {
    const key = skuNormalize(row.sku);
    if (key) invBySku.set(key, row);
  }

  const salesBySku = new Map<string, { qty: ReturnType<typeof toDecimal>; amount: ReturnType<typeof toDecimal>; lastDate: string | null; days: Set<string> }>();
  for (const row of sales) {
    const key = skuNormalize(row.sku);
    if (!key) continue;
    const prev = salesBySku.get(key) ?? {
      qty: toDecimal(0),
      amount: toDecimal(0),
      lastDate: null as string | null,
      days: new Set<string>(),
    };
    const q = normalizeMoney(row.salesQty);
    const a = normalizeMoney(row.salesAmount);
    if (q.ok) prev.qty = moneyAdd(prev.qty, q.value);
    if (a.ok) prev.amount = moneyAdd(prev.amount, a.value);
    const d = normalizeDate(row.date);
    if (d.ok) {
      prev.days.add(d.value);
      if (!prev.lastDate || d.value > prev.lastDate) prev.lastDate = d.value;
    }
    salesBySku.set(key, prev);
  }

  const dupSkus = new Set(detectDuplicateKeys(products, ['sku']).map((g) => g.key));
  const detail: DataRow[] = [];

  for (const row of products) {
    const codes: string[] = [];
    const sku = skuNormalize(row.sku);
    if (hasBlank(row.sku) || hasBlank(row.productName)) codes.push('MISSING');
    for (const attr of rules.requiredAttributes) {
      if (hasBlank(row[attr])) codes.push('MISSING');
    }
    if (dupSkus.has(sku.toLowerCase())) codes.push('DUPLICATE');

    const inv = invBySku.get(sku);
    const onHand = inventoryOnHand(inv?.availableQty ?? 0, inv?.reservedQty ?? 0);
    if (onHand.lt(0)) codes.push('NEGATIVE_STOCK');

    const sale = salesBySku.get(sku);
    const hasSalesHistory = Boolean(sale && sale.days.size > 0);
    let avgDaily: ReturnType<typeof toDecimal> | null = null;
    if (hasSalesHistory && sale) {
      const dayCount = Math.max(sale.days.size, 1);
      avgDaily = moneyDiv(sale.qty, dayCount);
    }
    const doi = daysOfInventory(onHand, avgDaily);
    if (doi !== null && Number(doi) > rules.daysOfInventoryThreshold) codes.push('OVERSTOCK');
    if (onHand.lte(0) && asText(row.status).toLowerCase() !== '下架') codes.push('STOCKOUT');

    if (hasSalesHistory && sale?.lastDate) {
      const gap = daysBetween(sale.lastDate, ctx.runDate);
      if (gap !== null && gap >= rules.lowSalesDays) codes.push('LOW_SALES');
    } else if (!hasSalesHistory && sales.length > 0) {
      codes.push('LOW_SALES');
    }

    const margin = grossMargin(row.price, row.cost);
    let marginStr = '';
    let marginRateStr = '';
    if (!margin.ok) {
      if (margin.reason === 'MISSING_COST' && asText(row.cost)) codes.push('MARGIN_EXCEPTION');
      if (asText(row.cost) && margin.reason === 'ZERO_PRICE') codes.push('MARGIN_EXCEPTION');
    } else {
      marginStr = moneyToFixed(margin.margin);
      marginRateStr = moneyToFixed(margin.marginRate);
      if (margin.margin.lt(0) || margin.marginRate.lt(rules.marginThreshold)) {
        codes.push('MARGIN_EXCEPTION');
      }
    }

    if (dupSkus.has(sku.toLowerCase()) && products.filter((p) => skuNormalize(p.sku) === sku).length > 1) {
      const siblings = products.filter((p) => skuNormalize(p.sku) === sku);
      const names = new Set(siblings.map((p) => asText(p.productName)));
      if (names.size > 1) codes.push('CONFLICT');
    }

    let status = 'READY';
    if (codes.length) status = 'NEEDS_REVIEW';

    detail.push({
      productId: asText(row.productId),
      sku,
      productName: asText(row.productName),
      price: asText(row.price),
      cost: asText(row.cost),
      grossMargin: marginStr,
      grossMarginRate: marginRateStr,
      availableQty: asText(inv?.availableQty ?? ''),
      reservedQty: asText(inv?.reservedQty ?? ''),
      onHandQty: moneyToFixed(onHand, 0),
      salesQty: sale ? moneyToFixed(sale.qty, 0) : '',
      daysOfInventory: doi ?? (hasSalesHistory ? '' : 'N/A_NO_SALES_HISTORY'),
      exceptionCodes: [...new Set(codes)].join('|'),
      status,
      sourceTrace: traceOf(row),
    });

    for (const code of [...new Set(codes)]) {
      ctx.exceptions.push({ code, severity: 'WARNING', message: code, row });
    }
  }

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '商品数据诊断_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '商品总表', rows: detail },
      { name: '重复SKU', rows: detail.filter((r) => asText(r.exceptionCodes).includes('DUPLICATE')) },
      { name: '数据缺失', rows: detail.filter((r) => asText(r.exceptionCodes).includes('MISSING')) },
      { name: '毛利异常', rows: detail.filter((r) => asText(r.exceptionCodes).includes('MARGIN')) },
      { name: '缺货风险', rows: detail.filter((r) => asText(r.exceptionCodes).includes('STOCKOUT') || asText(r.exceptionCodes).includes('NEGATIVE')) },
      { name: '库存积压', rows: detail.filter((r) => asText(r.exceptionCodes).includes('OVERSTOCK')) },
      { name: '低动销', rows: detail.filter((r) => asText(r.exceptionCodes).includes('LOW_SALES')) },
      { name: '数据冲突', rows: detail.filter((r) => asText(r.exceptionCodes).includes('CONFLICT')) },
      { name: '规则快照', rows: buildRuleSnapshotRows(rules as unknown as Record<string, unknown>) },
      {
        name: '运行说明',
        rows: buildHrRunNotes({
          workflowId: definition.id,
          workflowVersion: ctx.workflowVersion,
          runDate: ctx.runDate,
          rules: rules as unknown as Record<string, unknown>,
          inputSha256ByRole: ctx.inputSha256ByRole,
          inputRowCount: products.length,
          outputRowCount: detail.length,
          exceptionCount: ctx.exceptions.length,
          extras: [
            { key: 'control.onHandQty', value: financialControlTotal(detail, 'onHandQty') },
            { key: 'autoUpdateListing', value: false },
            { key: 'cloudUpload', value: false },
          ],
        }),
      },
    ],
  });

  const needsReview = detail.some((r) => asText(r.status) !== 'READY');
  ctx.metrics = {
    productCount: detail.length,
    duplicateCount: detail.filter((r) => asText(r.exceptionCodes).includes('DUPLICATE')).length,
    stockoutCount: detail.filter((r) => asText(r.exceptionCodes).includes('STOCKOUT')).length,
    cloudUpload: false,
    autoUpdateListing: false,
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
