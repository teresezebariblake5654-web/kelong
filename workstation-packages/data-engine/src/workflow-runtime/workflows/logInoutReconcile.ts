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
  daysBetween,
  exceedsQtyTolerance,
  formatQty,
  normalizeDate,
  normalizeSku,
  normalizeWarehouse,
  qtyDiff,
  sanitizeLogSummary,
  stockKey,
} from '../operators/logisticsCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { toLogInoutRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const MOVEMENT_ALIASES: FieldAliasMap = {
  docNo: ['单据号', '单号', 'docNo', 'doc_no', '入库单号', '出库单号', '单据编号'],
  sku: ['SKU', 'sku', '商品编码', '物料编码', '货号'],
  warehouse: ['仓库', 'warehouse', '仓码'],
  qty: ['数量', 'qty', 'quantity'],
  moveDate: ['日期', '业务日期', 'moveDate', 'move_date', '入库日期', '出库日期', '单据日期'],
  refNo: ['关联单号', 'refNo', 'ref_no', '参考号'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function movementKey(row: DataRow): string {
  const ref = asText(row.refNo) || asText(row.docNo);
  return `${stockKey(row.sku, row.warehouse)}||${ref.toLowerCase()}`;
}

/** LOG-INOUT-RECONCILE-002 — local inbound/outbound check; never posts to WMS. */
export async function executeLogInoutReconcile(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('inbound')) throw new Error('inbound is required');
  if (!ctx.datasets.get('outbound')) throw new Error('outbound is required');
  const rules = toLogInoutRules(ctx.companyRules);
  const inDs = ctx.datasets.get('inbound')!;
  const outDs = ctx.datasets.get('outbound')!;
  const inbound = normalizeColumns(inDs.rows, MOVEMENT_ALIASES, {
    role: 'inbound',
    sourceFile: inDs.fileName,
    sourceSheet: inDs.sheetName,
    inputSha256: inDs.sha256,
  });
  const outbound = normalizeColumns(outDs.rows, MOVEMENT_ALIASES, {
    role: 'outbound',
    sourceFile: outDs.fileName,
    sourceSheet: outDs.sheetName,
    inputSha256: outDs.sha256,
  });

  const outByKey = new Map<string, DataRow>();
  for (const row of outbound) outByKey.set(movementKey(row), row);

  const matchedOut = new Set<string>();
  const detail: DataRow[] = [];

  for (const row of inbound) {
    const codes: string[] = [];
    const key = movementKey(row);
    const pair = outByKey.get(key);
    if (hasBlank(row.sku) || hasBlank(row.qty)) codes.push('INVALID');

    let status = 'MATCHED';
    let qtyDiffStr = '';
    let dateDiffDays: number | '' = '';

    if (!pair) {
      codes.push('UNMATCHED_IN');
      status = 'UNMATCHED';
    } else {
      matchedOut.add(key);
      const diff = qtyDiff(row.qty, pair.qty);
      if (!Number.isFinite(diff)) {
        codes.push('INVALID');
        status = 'INVALID';
      } else {
        qtyDiffStr = formatQty(diff);
        if (exceedsQtyTolerance(diff, rules.qtyTolerance)) {
          codes.push('QTY_MISMATCH');
          status = 'IN_EXCEPTION';
        }
      }
      const dIn = normalizeDate(row.moveDate);
      const dOut = normalizeDate(pair.moveDate);
      if (dIn.ok && dOut.ok) {
        const gap = daysBetween(dIn.value, dOut.value);
        if (gap !== null) {
          dateDiffDays = Math.abs(gap);
          if (Math.abs(gap) > rules.dateToleranceDays) {
            codes.push('DATE_MISMATCH');
            if (status === 'MATCHED') status = 'IN_EXCEPTION';
          }
        }
      }
    }

    detail.push({
      side: 'IN',
      docNo: asText(row.docNo),
      sku: normalizeSku(row.sku),
      warehouse: normalizeWarehouse(row.warehouse),
      qty: asText(row.qty),
      pairQty: pair ? asText(pair.qty) : '',
      qtyDifference: qtyDiffStr,
      moveDate: asText(row.moveDate),
      pairDate: pair ? asText(pair.moveDate) : '',
      dateDiffDays,
      exceptionCodes: [...new Set(codes)].join('|'),
      status,
      sourceTrace: traceOf(row),
    });

    for (const code of [...new Set(codes)]) {
      ctx.exceptions.push({ code, severity: 'WARNING', message: code, row });
    }
  }

  for (const [key, row] of outByKey) {
    if (matchedOut.has(key)) continue;
    const codes = ['UNMATCHED_OUT'];
    if (hasBlank(row.sku) || hasBlank(row.qty)) codes.push('INVALID');
    detail.push({
      side: 'OUT',
      docNo: asText(row.docNo),
      sku: normalizeSku(row.sku),
      warehouse: normalizeWarehouse(row.warehouse),
      qty: asText(row.qty),
      pairQty: '',
      qtyDifference: '',
      moveDate: asText(row.moveDate),
      pairDate: '',
      dateDiffDays: '',
      exceptionCodes: codes.join('|'),
      status: 'UNMATCHED',
      sourceTrace: traceOf(row),
    });
    for (const code of codes) {
      ctx.exceptions.push({ code, severity: 'WARNING', message: code, row });
    }
  }

  const inEx = detail.filter((r) => asText(r.side) === 'IN' && asText(r.status) !== 'MATCHED');
  const outEx = detail.filter((r) => asText(r.side) === 'OUT' && asText(r.status) !== 'MATCHED');
  const unmatched = detail.filter((r) => asText(r.status) === 'UNMATCHED');

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '出入库核对_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '核对总表', rows: detail },
      { name: '入库异常', rows: inEx },
      { name: '出库异常', rows: outEx },
      { name: '未匹配', rows: unmatched },
      { name: '规则快照', rows: buildRuleSnapshotRows(rules as unknown as Record<string, unknown>) },
      {
        name: '运行说明',
        rows: buildHrRunNotes({
          workflowId: definition.id,
          workflowVersion: ctx.workflowVersion,
          runDate: ctx.runDate,
          rules: rules as unknown as Record<string, unknown>,
          inputSha256ByRole: ctx.inputSha256ByRole,
          inputRowCount: inbound.length + outbound.length,
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

  const needsReview = detail.some((r) => asText(r.status) !== 'MATCHED');
  ctx.metrics = {
    lineCount: detail.length,
    unmatchedCount: unmatched.length,
    inboundExceptionCount: inEx.length,
    outboundExceptionCount: outEx.length,
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
