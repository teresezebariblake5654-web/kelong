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
  exceedsQtyTolerance,
  formatQty,
  normalizeSku,
  normalizeWarehouse,
  qtyDiff,
  qtyNumber,
  sanitizeLogSummary,
  stockKey,
} from '../operators/logisticsCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { toLogInventoryRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const LEDGER_ALIASES: FieldAliasMap = {
  sku: ['SKU', 'sku', '商品编码', '物料编码', '货号'],
  warehouse: ['仓库', 'warehouse', '仓码', '仓库编码'],
  onHand: ['账面库存', '账面数量', '库存', 'onHand', 'on_hand', '账存'],
  asOfDate: ['截止日期', '账面日期', 'asOfDate', 'as_of_date', '库存日期'],
};

const COUNT_ALIASES: FieldAliasMap = {
  sku: ['SKU', 'sku', '商品编码', '物料编码', '货号'],
  warehouse: ['仓库', 'warehouse', '仓码', '仓库编码'],
  countedQty: ['实盘数量', '盘点数量', 'countedQty', 'counted_qty', '实盘'],
  countDate: ['盘点日期', 'countDate', 'count_date', '日期'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

/** LOG-INVENTORY-COUNT-001 — local variance report; never auto-adjusts WMS/stock. */
export async function executeLogInventoryCount(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('stock_ledger')) throw new Error('stock_ledger is required');
  if (!ctx.datasets.get('physical_count')) throw new Error('physical_count is required');
  const rules = toLogInventoryRules(ctx.companyRules);
  const ledgerDs = ctx.datasets.get('stock_ledger')!;
  const countDs = ctx.datasets.get('physical_count')!;
  const ledger = normalizeColumns(ledgerDs.rows, LEDGER_ALIASES, {
    role: 'stock_ledger',
    sourceFile: ledgerDs.fileName,
    sourceSheet: ledgerDs.sheetName,
    inputSha256: ledgerDs.sha256,
  });
  const counts = normalizeColumns(countDs.rows, COUNT_ALIASES, {
    role: 'physical_count',
    sourceFile: countDs.fileName,
    sourceSheet: countDs.sheetName,
    inputSha256: countDs.sha256,
  });

  const ledgerMap = new Map<string, DataRow>();
  for (const row of ledger) {
    const key = stockKey(row.sku, row.warehouse);
    if (key !== '||') ledgerMap.set(key, row);
  }
  const countMap = new Map<string, DataRow>();
  for (const row of counts) {
    const key = stockKey(row.sku, row.warehouse);
    if (key !== '||') countMap.set(key, row);
  }

  const detail: DataRow[] = [];
  for (const key of new Set([...ledgerMap.keys(), ...countMap.keys()])) {
    const ledgerRow = ledgerMap.get(key);
    const countRow = countMap.get(key);
    const codes: string[] = [];
    const sku = normalizeSku(ledgerRow?.sku ?? countRow?.sku);
    const warehouse = normalizeWarehouse(ledgerRow?.warehouse ?? countRow?.warehouse);
    const onHand = qtyNumber(ledgerRow?.onHand ?? 0);
    const counted = qtyNumber(countRow?.countedQty ?? 0);

    if (hasBlank(sku) || hasBlank(warehouse)) codes.push('INVALID');
    if (!ledgerRow) codes.push('OVERAGE_ONLY');
    if (!countRow) codes.push('SHORTAGE_ONLY');

    let variance = NaN;
    let status = 'MATCHED';
    if (ledgerRow && countRow) {
      variance = qtyDiff(counted, onHand);
      if (!Number.isFinite(variance)) {
        codes.push('INVALID');
        status = 'INVALID';
      } else if (exceedsQtyTolerance(variance, rules.qtyTolerance)) {
        if (variance < 0) {
          codes.push('SHORTAGE');
          status = 'SHORTAGE';
        } else if (variance > 0) {
          codes.push('OVERAGE');
          status = 'OVERAGE';
        }
      }
    } else if (!countRow) {
      status = 'SHORTAGE';
      codes.push('SHORTAGE');
      variance = -onHand;
    } else {
      status = 'OVERAGE';
      codes.push('OVERAGE');
      variance = counted;
    }

    detail.push({
      sku,
      warehouse,
      onHand: Number.isFinite(onHand) ? formatQty(onHand) : asText(ledgerRow?.onHand),
      countedQty: Number.isFinite(counted) ? formatQty(counted) : asText(countRow?.countedQty),
      qtyDifference: Number.isFinite(variance) ? formatQty(variance) : '',
      asOfDate: asText(ledgerRow?.asOfDate),
      countDate: asText(countRow?.countDate),
      matchRule: rules.matchRule,
      exceptionCodes: [...new Set(codes)].join('|'),
      status,
      sourceTrace: traceOf(countRow ?? ledgerRow!),
    });

    for (const code of [...new Set(codes)]) {
      ctx.exceptions.push({
        code,
        severity: code === 'INVALID' ? 'BLOCKING' : 'WARNING',
        message: code,
        row: countRow ?? ledgerRow,
      });
    }
  }

  const shortage = detail.filter(
    (r) => asText(r.status) === 'SHORTAGE' || asText(r.exceptionCodes).includes('SHORTAGE'),
  );
  const overage = detail.filter(
    (r) => asText(r.status) === 'OVERAGE' || asText(r.exceptionCodes).includes('OVERAGE'),
  );
  const varianceRows = detail.filter((r) => asText(r.status) !== 'MATCHED');

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '库存盘点结果_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '盘点总表', rows: detail },
      { name: '盘亏', rows: shortage },
      { name: '盘盈', rows: overage },
      { name: '差异明细', rows: varianceRows },
      { name: '规则快照', rows: buildRuleSnapshotRows(rules as unknown as Record<string, unknown>) },
      {
        name: '运行说明',
        rows: buildHrRunNotes({
          workflowId: definition.id,
          workflowVersion: ctx.workflowVersion,
          runDate: ctx.runDate,
          rules: rules as unknown as Record<string, unknown>,
          inputSha256ByRole: ctx.inputSha256ByRole,
          inputRowCount: ledger.length + counts.length,
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

  ctx.metrics = {
    lineCount: detail.length,
    shortageCount: shortage.length,
    overageCount: overage.length,
    skuCount: countDistinct(detail, 'sku'),
    cloudUpload: false,
    autoAdjustStock: false,
  };

  return {
    runId: ctx.runId,
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    status: varianceRows.length ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath],
    metrics: ctx.metrics,
    exceptions: aggregateExceptionCounts(ctx.exceptions),
    aiSummaryPayload: sanitizeLogSummary({
      workflowId: definition.id,
      workflowVersion: ctx.workflowVersion,
      runId: ctx.runId,
      metrics: { ...ctx.metrics },
    }),
  };
}
