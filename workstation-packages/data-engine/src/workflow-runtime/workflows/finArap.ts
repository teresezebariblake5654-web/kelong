import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  agingBucket,
  financialControlTotal,
  moneyAdd,
  moneyMul,
  moneyToFixed,
  normalizeMoney,
  overdueDays,
  parseYmdOrNull,
  sanitizeFinancialSummary,
  toDecimal,
} from '../operators/financeCommon.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  buildRuleSnapshotRows,
  detectDuplicateKeys,
} from '../operators/hrCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { toArapRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const OPEN_ALIASES: FieldAliasMap = {
  documentNo: ['单据号', '发票号', 'documentNo', 'document_no', 'invoiceNo'],
  partyCode: ['客商编码', '客户编码', '供应商编码', 'partyCode', 'party_code', 'customerCode'],
  partyName: ['客商名称', '客户', '供应商', 'partyName', 'party_name'],
  documentType: ['单据类型', '收付类型', 'documentType', 'document_type', 'type'],
  invoiceDate: ['开票日期', '单据日期', 'invoiceDate', 'invoice_date'],
  dueDate: ['到期日', '到期日期', 'dueDate', 'due_date'],
  originalAmount: ['原币金额', '原金额', 'originalAmount', 'original_amount'],
  openAmount: ['未结金额', '余额', 'openAmount', 'open_amount', 'balance'],
  currency: ['币种', 'currency'],
  disputeFlag: ['争议', 'dispute', 'disputeFlag'],
  riskLevel: ['风险等级', 'risk', 'riskLevel'],
};
const PAY_ALIASES: FieldAliasMap = {
  paymentNo: ['收付款号', 'paymentNo', 'payment_no'],
  partyCode: ['客商编码', 'partyCode', 'party_code'],
  date: ['日期', 'date'],
  amount: ['金额', 'amount'],
  referenceNo: ['参考号', 'referenceNo', 'reference'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function isReceivable(docType: unknown): boolean {
  const t = asText(docType).toUpperCase();
  return t === 'AR' || t.includes('应收') || t === 'RECEIVABLE';
}

function isPayable(docType: unknown): boolean {
  const t = asText(docType).toUpperCase();
  return t === 'AP' || t.includes('应付') || t === 'PAYABLE';
}

function priorityScore(input: {
  overdueDays: number;
  openAmount: ReturnType<typeof toDecimal>;
  riskLevel: unknown;
  disputeFlag: unknown;
}): number {
  const risk = asText(input.riskLevel).toUpperCase();
  const riskBoost = risk === 'HIGH' || risk === '高' ? 1.5 : risk === 'MEDIUM' || risk === '中' ? 1.2 : 1;
  const dispute = asText(input.disputeFlag);
  const disputePenalty =
    dispute && !['0', 'false', 'no', '否', 'n'].includes(dispute.toLowerCase()) ? 0.5 : 1;
  const amountFactor = Math.min(input.openAmount.abs().toNumber() / 10000, 5);
  const daysFactor = Math.min(input.overdueDays / 30, 6);
  return Number(((daysFactor * 10 + amountFactor * 8) * riskBoost * disputePenalty).toFixed(4));
}

/** FIN-ARAP-003 — aging & priority suggestions only. */
export async function executeFinArap(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('open_items')) throw new Error('open_items is required');
  const rules = toArapRules(ctx.companyRules);
  const openDs = ctx.datasets.get('open_items')!;
  const opens = normalizeColumns(openDs.rows, OPEN_ALIASES, {
    role: 'open_items',
    sourceFile: openDs.fileName,
    sourceSheet: openDs.sheetName,
    inputSha256: openDs.sha256,
  });
  const payDs = ctx.datasets.get('payments');
  const payments = payDs
    ? normalizeColumns(payDs.rows, PAY_ALIASES, {
        role: 'payments',
        sourceFile: payDs.fileName,
        sourceSheet: payDs.sheetName,
        inputSha256: payDs.sha256,
      })
    : [];

  const dupKeys = new Set(detectDuplicateKeys(opens, ['documentNo']).map((d) => d.key));
  const materiality = toDecimal(rules.materialityAmount);
  const detail: DataRow[] = [];
  const exceptions: DataRow[] = [];

  for (const row of opens) {
    const codes: string[] = [];
    const sourceTrace = traceOf(row);
    const openAmt = normalizeMoney(row.openAmount);
    const original = normalizeMoney(row.originalAmount);
    const invoiceDate = parseYmdOrNull(row.invoiceDate);
    const due = parseYmdOrNull(row.dueDate);
    const overdue = overdueDays(ctx.runDate, row.dueDate);
    if (hasBlank(row.documentNo) || hasBlank(row.partyCode) || hasBlank(row.documentType)) {
      codes.push('MISSING_REQUIRED_FIELD');
    }
    if (!openAmt.ok || !original.ok) codes.push('INVALID_AMOUNT');
    if (!invoiceDate || !due) codes.push('INVALID_DATE');
    if (invoiceDate && due && due < invoiceDate) codes.push('DUE_BEFORE_INVOICE');
    if (openAmt.ok && openAmt.value.isNegative()) codes.push('NEGATIVE_BALANCE');
    if (dupKeys.has(asText(row.documentNo).toLowerCase())) codes.push('DUPLICATE');
    if (
      overdue !== null &&
      overdue >= rules.longOverdueDays &&
      openAmt.ok &&
      openAmt.value.abs().gte(materiality)
    ) {
      codes.push('LONG_OVERDUE');
    }
    const ccy = asText(row.currency || 'CNY').toUpperCase();
    if (row.currency && ccy !== 'CNY' && ccy !== 'RMB') codes.push('CURRENCY_EXCEPTION');

    const overdueVal = overdue ?? 0;
    const bucket = agingBucket(overdueVal);
    const openValue = openAmt.ok ? openAmt.value : toDecimal(0);
    const score = priorityScore({
      overdueDays: overdueVal,
      openAmount: openValue,
      riskLevel: row.riskLevel,
      disputeFlag: row.disputeFlag,
    });

    for (const code of codes) {
      ctx.exceptions.push({
        code,
        severity: code === 'LONG_OVERDUE' || code === 'NEGATIVE_BALANCE' ? 'BLOCKING' : 'WARNING',
        message: code,
        row: { documentNo: row.documentNo },
      });
      exceptions.push({
        documentNo: row.documentNo,
        partyCode: row.partyCode,
        partyName: row.partyName,
        code,
        openAmount: openAmt.ok ? moneyToFixed(openAmt.value) : asText(row.openAmount),
        sourceTrace,
      });
    }

    detail.push({
      documentNo: row.documentNo,
      partyCode: row.partyCode,
      partyName: row.partyName,
      documentType: row.documentType,
      invoiceDate: invoiceDate ?? asText(row.invoiceDate),
      dueDate: due ?? asText(row.dueDate),
      originalAmount: original.ok ? moneyToFixed(original.value) : asText(row.originalAmount),
      openAmount: openAmt.ok ? moneyToFixed(openAmt.value) : asText(row.openAmount),
      overdueDays: overdueVal,
      agingBucket: bucket,
      priorityScore: Number(score.toFixed(4)),
      currency: ccy,
      exceptionCodes: codes.join('|'),
      status: codes.length ? 'NEEDS_REVIEW' : 'READY',
      sourceTrace,
    });
  }

  // Optional payments retained for future apply-hints; concentration uses open items only.
  void payments;

  const ar = detail.filter((r) => isReceivable(r.documentType));
  const ap = detail.filter((r) => isPayable(r.documentType));
  const collection = [...ar]
    .sort(
      (a, b) =>
        Number(b.priorityScore) - Number(a.priorityScore) ||
        Number(b.overdueDays) - Number(a.overdueDays),
    )
    .map((r) => ({
      partyCode: r.partyCode,
      partyName: r.partyName,
      documentNo: r.documentNo,
      openAmount: r.openAmount,
      overdueDays: r.overdueDays,
      agingBucket: r.agingBucket,
      priorityScore: r.priorityScore,
      sourceTrace: r.sourceTrace,
    }));
  const paymentPriority = [...ap]
    .sort(
      (a, b) =>
        Number(b.priorityScore) - Number(a.priorityScore) ||
        Number(b.overdueDays) - Number(a.overdueDays),
    )
    .map((r) => ({
      partyCode: r.partyCode,
      partyName: r.partyName,
      documentNo: r.documentNo,
      openAmount: r.openAmount,
      overdueDays: r.overdueDays,
      agingBucket: r.agingBucket,
      priorityScore: r.priorityScore,
      sourceTrace: r.sourceTrace,
    }));

  const concentration = new Map<string, { partyName: string; open: ReturnType<typeof toDecimal>; count: number; side: string }>();
  for (const row of detail) {
    const side = isReceivable(row.documentType) ? 'AR' : isPayable(row.documentType) ? 'AP' : 'OTHER';
    const key = `${side}||${asText(row.partyCode)}`;
    const prev = concentration.get(key) ?? {
      partyName: asText(row.partyName),
      open: toDecimal(0),
      count: 0,
      side,
    };
    prev.open = moneyAdd(prev.open, row.openAmount);
    prev.count += 1;
    concentration.set(key, prev);
  }
  const totalOpen = detail.reduce((a, r) => moneyAdd(a, r.openAmount), toDecimal(0));
  const concentrationRows: DataRow[] = [...concentration.entries()]
    .map(([key, v]) => {
      const partyCode = key.split('||')[1] ?? '';
      const share = totalOpen.isZero() ? toDecimal(0) : moneyMul(v.open.div(totalOpen), 100);
      return {
        side: v.side,
        partyCode,
        partyName: v.partyName,
        documentCount: v.count,
        openAmount: moneyToFixed(v.open),
        concentrationPct: moneyToFixed(share),
      };
    })
    .sort((a, b) => toDecimal(b.openAmount).comparedTo(toDecimal(a.openAmount)));

  const controlOpen = financialControlTotal(detail, 'openAmount');
  const ruleSnapshot = buildRuleSnapshotRows(rules as unknown as Record<string, unknown>);
  const runNotes = buildHrRunNotes({
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    runDate: ctx.runDate,
    rules: rules as unknown as Record<string, unknown>,
    inputSha256ByRole: ctx.inputSha256ByRole,
    inputRowCount: opens.length,
    outputRowCount: detail.length,
    exceptionCount: exceptions.length,
    extras: [
      { key: 'control.openAmount', value: controlOpen },
      { key: 'paymentHintCount', value: payments.length },
      { key: 'cloudUpload', value: false },
    ],
  });

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '应收应付账龄_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '应收账龄', rows: ar },
      { name: '应付账龄', rows: ap },
      { name: '催收优先级', rows: collection },
      { name: '付款优先级', rows: paymentPriority },
      { name: '异常项目', rows: exceptions },
      { name: '集中度汇总', rows: concentrationRows },
      { name: '规则快照', rows: ruleSnapshot },
      { name: '运行说明', rows: runNotes },
    ],
  });

  const needsReview = detail.some((r) => asText(r.status) !== 'READY');
  ctx.metrics = {
    openItemCount: detail.length,
    arCount: ar.length,
    apCount: ap.length,
    exceptionCount: exceptions.length,
    controlOpenAmount: controlOpen,
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
    aiSummaryPayload: sanitizeFinancialSummary({
      workflowId: definition.id,
      workflowVersion: ctx.workflowVersion,
      runId: ctx.runId,
      metrics: { ...ctx.metrics },
    }),
  };
}
