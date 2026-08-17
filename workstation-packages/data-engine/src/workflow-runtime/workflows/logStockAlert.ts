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
  formatQty,
  normalizeSku,
  normalizeWarehouse,
  qtyNumber,
  sanitizeLogSummary,
  stockKey,
} from '../operators/logisticsCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { toLogAlertRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const INV_ALIASES: FieldAliasMap = {
  sku: ['SKU', 'sku', '商品编码', '物料编码', '货号'],
  warehouse: ['仓库', 'warehouse', '仓码'],
  onHand: ['库存', 'onHand', 'on_hand', '现存量', '可用库存', '数量'],
  safetyStock: ['安全库存', 'safetyStock', 'safety_stock', '最低库存'],
};

const VELOCITY_ALIASES: FieldAliasMap = {
  sku: ['SKU', 'sku', '商品编码', '物料编码'],
  warehouse: ['仓库', 'warehouse'],
  avgDailySales: ['日均销量', 'avgDailySales', 'avg_daily_sales', '日销'],
  salesQty: ['销量', 'salesQty', 'sales_qty', '数量'],
  days: ['天数', 'days', '统计天数'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

/** LOG-STOCK-ALERT-004 — advisory alerts only; never auto-adjusts stock. */
export async function executeLogStockAlert(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('inventory')) throw new Error('inventory is required');
  const rules = toLogAlertRules(ctx.companyRules);
  const invDs = ctx.datasets.get('inventory')!;
  const inventory = normalizeColumns(invDs.rows, INV_ALIASES, {
    role: 'inventory',
    sourceFile: invDs.fileName,
    sourceSheet: invDs.sheetName,
    inputSha256: invDs.sha256,
  });
  const velDs = ctx.datasets.get('sales_velocity');
  const velocity = velDs
    ? normalizeColumns(velDs.rows, VELOCITY_ALIASES, {
        role: 'sales_velocity',
        sourceFile: velDs.fileName,
        sourceSheet: velDs.sheetName,
        inputSha256: velDs.sha256,
      })
    : [];

  const velByKey = new Map<string, number>();
  for (const row of velocity) {
    const key = stockKey(row.sku, row.warehouse);
    const avg = qtyNumber(row.avgDailySales);
    if (Number.isFinite(avg)) {
      velByKey.set(key, avg);
      continue;
    }
    const qty = qtyNumber(row.salesQty);
    const days = qtyNumber(row.days);
    if (Number.isFinite(qty) && Number.isFinite(days) && days > 0) {
      velByKey.set(key, qty / days);
    }
  }

  const detail: DataRow[] = [];
  for (const row of inventory) {
    const codes: string[] = [];
    const sku = normalizeSku(row.sku);
    const warehouse = normalizeWarehouse(row.warehouse);
    if (hasBlank(row.sku) || hasBlank(row.onHand)) codes.push('INVALID');

    const onHand = qtyNumber(row.onHand);
    const safety = qtyNumber(row.safetyStock);
    if (Number.isFinite(onHand) && Number.isFinite(safety) && onHand < safety) {
      codes.push('LOW_STOCK');
    }

    const avg = velByKey.get(stockKey(row.sku, row.warehouse));
    let doi: number | null = null;
    if (avg !== undefined && avg > 0 && Number.isFinite(onHand)) {
      doi = onHand / avg;
      if (doi <= rules.lowStockDays) codes.push('LOW_STOCK');
      if (doi >= rules.overstockDays) codes.push('OVERSTOCK');
    }

    let alert = 'OK';
    if (codes.includes('LOW_STOCK')) alert = 'LOW_STOCK';
    else if (codes.includes('OVERSTOCK')) alert = 'OVERSTOCK';
    else if (codes.includes('INVALID')) alert = 'INVALID';

    detail.push({
      sku,
      warehouse,
      onHand: Number.isFinite(onHand) ? formatQty(onHand) : asText(row.onHand),
      safetyStock: Number.isFinite(safety) ? formatQty(safety) : asText(row.safetyStock),
      avgDailySales: avg !== undefined ? formatQty(avg, 2) : '',
      daysOfInventory: doi === null ? '' : formatQty(doi, 2),
      exceptionCodes: [...new Set(codes)].join('|'),
      alert,
      sourceTrace: traceOf(row),
    });

    for (const code of [...new Set(codes)]) {
      ctx.exceptions.push({ code, severity: 'WARNING', message: code, row });
    }
  }

  const low = detail.filter((r) => asText(r.alert) === 'LOW_STOCK');
  const over = detail.filter((r) => asText(r.alert) === 'OVERSTOCK');

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '库存预警_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '预警总表', rows: detail },
      { name: '低库存', rows: low },
      { name: '积压', rows: over },
      { name: '规则快照', rows: buildRuleSnapshotRows(rules as unknown as Record<string, unknown>) },
      {
        name: '运行说明',
        rows: buildHrRunNotes({
          workflowId: definition.id,
          workflowVersion: ctx.workflowVersion,
          runDate: ctx.runDate,
          rules: rules as unknown as Record<string, unknown>,
          inputSha256ByRole: ctx.inputSha256ByRole,
          inputRowCount: inventory.length,
          outputRowCount: detail.length,
          exceptionCount: ctx.exceptions.length,
          extras: [
            { key: 'skuCount', value: countDistinct(detail, 'sku') },
            { key: 'cloudUpload', value: false },
            { key: 'autoAdjustStock', value: false },
          ],
        }),
      },
    ],
  });

  const needsReview = detail.some((r) => asText(r.alert) !== 'OK');
  ctx.metrics = {
    lineCount: detail.length,
    lowStockCount: low.length,
    overstockCount: over.length,
    skuCount: countDistinct(detail, 'sku'),
    cloudUpload: false,
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
