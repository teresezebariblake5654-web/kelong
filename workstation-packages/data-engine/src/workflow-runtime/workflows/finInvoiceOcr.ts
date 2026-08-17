import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import {
  extractInvoicesWithRegistry,
  type InvoiceOcrExtracted,
} from '../adapters/InvoiceOcrProvider.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  moneyAdd,
  moneyToFixed,
  normalizeMoney,
  sanitizeFinancialSummary,
  textSimilarity,
  toDecimal,
} from '../operators/financeCommon.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  buildRuleSnapshotRows,
} from '../operators/hrCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import { toInvoiceOcrRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const PURCHASE_ALIASES: FieldAliasMap = {
  purchaseNo: ['采购单号', 'purchaseNo', 'purchase_no', 'poNo'],
  vendorName: ['供应商', 'vendor', 'vendorName', 'sellerName'],
  amount: ['金额', 'amount'],
  taxAmount: ['税额', 'taxAmount', 'tax'],
  totalAmount: ['价税合计', 'totalAmount', 'total'],
  date: ['日期', '采购日期', 'date'],
};

function dupKey(item: InvoiceOcrExtracted): string {
  return [
    item.invoiceCode,
    item.invoiceNo,
    item.sellerTaxId,
    item.totalAmount,
  ]
    .map((v) => asText(v).toLowerCase())
    .join('||');
}

/** FIN-INVOICE-OCR-004 — structured/local only; no cloud or fake image OCR. */
export async function executeFinInvoiceOcr(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('invoice_files')) throw new Error('invoice_files is required');
  const rules = toInvoiceOcrRules(ctx.companyRules);
  const invDs = ctx.datasets.get('invoice_files')!;
  const purchaseDs = ctx.datasets.get('purchase_records');
  const purchases = purchaseDs
    ? normalizeColumns(purchaseDs.rows, PURCHASE_ALIASES, {
        role: 'purchase_records',
        sourceFile: purchaseDs.fileName,
        sourceSheet: purchaseDs.sheetName,
        inputSha256: purchaseDs.sha256,
      })
    : [];

  const extracted = await extractInvoicesWithRegistry({
    ocrMode: rules.ocrMode,
    rows: invDs.rows,
    fileName: invDs.fileName,
  });

  const register: DataRow[] = [];
  const duplicates: DataRow[] = [];
  const lowConfidence: DataRow[] = [];
  const purchaseMatched: DataRow[] = [];
  const amountExceptions: DataRow[] = [];
  const tol = toDecimal(rules.amountTolerance);

  if (extracted.unavailable) {
    const row: DataRow = {
      status: 'OCR_PROVIDER_UNAVAILABLE',
      provider: extracted.provider.name,
      confidence: 0,
      message: 'Image/PDF without structured rows — no cloud OCR',
      fileName: invDs.fileName,
      sourceTrace: invDs.fileName,
    };
    register.push(row);
    ctx.exceptions.push({
      code: 'OCR_PROVIDER_UNAVAILABLE',
      severity: 'BLOCKING',
      message: 'OCR provider unavailable for image/PDF-only input',
      row,
    });
  }

  const seen = new Map<string, number>();
  for (const item of extracted.items) {
    const key = dupKey(item);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  for (const item of extracted.items) {
    const codes: string[] = [];
    const amount = normalizeMoney(item.amount);
    const tax = normalizeMoney(item.taxAmount);
    const total = normalizeMoney(item.totalAmount);
    let arithmeticDiff = '';
    if (amount.ok && tax.ok && total.ok) {
      const expected = moneyAdd(amount.value, tax.value);
      const diff = total.value.minus(expected).abs();
      arithmeticDiff = moneyToFixed(diff);
      if (diff.gt(tol)) codes.push('AMOUNT_MISMATCH');
    } else if (hasBlank(item.invoiceNo) || hasBlank(item.totalAmount)) {
      codes.push('INVALID');
    }

    if (item.confidence < rules.confidenceThreshold || item.statusHint === 'NEEDS_MANUAL') {
      codes.push('LOW_CONFIDENCE');
    }
    const key = dupKey(item);
    if ((seen.get(key) ?? 0) > 1 && asText(item.invoiceNo)) codes.push('DUPLICATE');

    let purchaseNo = '';
    let purchaseScore = 0;
    for (const p of purchases) {
      const pAmount = normalizeMoney(p.amount ?? p.totalAmount);
      const vendorSim = textSimilarity(item.sellerName || item.normalized.sellerName, p.vendorName);
      const amountOk =
        pAmount.ok && total.ok ? total.value.minus(pAmount.value).abs().lte(tol) : false;
      const score = (vendorSim >= 0.8 ? 0.5 : vendorSim * 0.5) + (amountOk ? 0.5 : 0);
      if (score > purchaseScore) {
        purchaseScore = score;
        purchaseNo = asText(p.purchaseNo);
      }
    }
    if (purchaseScore >= 0.8) codes.push('PURCHASE_MATCHED');

    let status = 'READY';
    if (codes.includes('INVALID')) status = 'INVALID';
    else if (codes.includes('DUPLICATE')) status = 'DUPLICATE';
    else if (codes.includes('AMOUNT_MISMATCH')) status = 'AMOUNT_MISMATCH';
    else if (codes.includes('LOW_CONFIDENCE')) status = 'LOW_CONFIDENCE';
    else if (codes.includes('PURCHASE_MATCHED')) status = 'PURCHASE_MATCHED';

    for (const code of codes.filter((c) => c !== 'PURCHASE_MATCHED' && c !== 'READY')) {
      ctx.exceptions.push({
        code,
        severity: code === 'LOW_CONFIDENCE' ? 'WARNING' : 'BLOCKING',
        message: code,
        row: { invoiceNo: item.invoiceNo },
      });
    }

    const row: DataRow = {
      invoiceCode: item.invoiceCode,
      invoiceNo: item.invoiceNo,
      invoiceDate: item.invoiceDate,
      sellerName: item.sellerName,
      sellerTaxId: item.sellerTaxId,
      buyerName: item.buyerName,
      buyerTaxId: item.buyerTaxId,
      amount: item.amount,
      taxAmount: item.taxAmount,
      totalAmount: item.totalAmount,
      arithmeticDiff,
      confidence: item.confidence,
      provider: item.provider,
      original: JSON.stringify(item.original),
      normalized: JSON.stringify(item.normalized),
      purchaseNo,
      purchaseScore: Number(purchaseScore.toFixed(4)),
      status,
      exceptionCodes: codes.join('|'),
      sourceTrace: item.sourceTrace ?? invDs.fileName,
    };
    register.push(row);
    if (status === 'DUPLICATE' || codes.includes('DUPLICATE')) duplicates.push(row);
    if (status === 'LOW_CONFIDENCE' || codes.includes('LOW_CONFIDENCE')) lowConfidence.push(row);
    if (codes.includes('PURCHASE_MATCHED')) purchaseMatched.push(row);
    if (codes.includes('AMOUNT_MISMATCH') || status === 'INVALID') amountExceptions.push(row);
  }

  // Ensure date normalized display
  for (const row of register) {
    const d = normalizeDate(row.invoiceDate);
    if (d.ok) row.invoiceDate = d.value;
  }

  const ruleSnapshot = buildRuleSnapshotRows(rules as unknown as Record<string, unknown>, {
    cloudOcr: false,
    fakeImageOcr: false,
  });
  const runNotes = buildHrRunNotes({
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    runDate: ctx.runDate,
    rules: rules as unknown as Record<string, unknown>,
    inputSha256ByRole: ctx.inputSha256ByRole,
    inputRowCount: invDs.rows.length,
    outputRowCount: register.length,
    exceptionCount: ctx.exceptions.length,
    extras: [
      { key: 'provider', value: extracted.provider.name },
      { key: 'ocrUnavailable', value: extracted.unavailable },
      { key: 'cloudUpload', value: false },
    ],
  });

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '发票识别与核对_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '发票登记表', rows: register },
      { name: '重复发票', rows: duplicates },
      { name: '低置信度', rows: lowConfidence },
      { name: '采购匹配', rows: purchaseMatched },
      { name: '金额异常', rows: amountExceptions },
      { name: '规则快照', rows: ruleSnapshot },
      { name: '运行说明', rows: runNotes },
    ],
  });

  const needsReview = register.some((r) => asText(r.status) !== 'READY' && asText(r.status) !== 'PURCHASE_MATCHED');
  ctx.metrics = {
    invoiceCount: register.length,
    duplicateCount: duplicates.length,
    lowConfidenceCount: lowConfidence.length,
    purchaseMatchedCount: purchaseMatched.length,
    ocrUnavailable: extracted.unavailable,
    cloudUpload: false,
    cloudOcr: false,
  };

  return {
    runId: ctx.runId,
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    status: needsReview || extracted.unavailable ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath],
    metrics: ctx.metrics,
    exceptions: aggregateExceptionCounts(ctx.exceptions),
    aiSummaryPayload: sanitizeFinancialSummary({
      workflowId: definition.id,
      workflowVersion: ctx.workflowVersion,
      runId: ctx.runId,
      metrics: { ...ctx.metrics },
    }),
  };
}
