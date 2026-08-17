import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import { daysBetween } from '../operators/dateWindow.js';
import {
  Decimal,
  financialControlTotal,
  financialPeriod,
  moneyToFixed,
  normalizeSignedMoney,
  sanitizeFinancialSummary,
  scoredMatch,
  subsetMatchAmounts,
  textSimilarity,
  toDecimal,
} from '../operators/financeCommon.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  buildRuleSnapshotRows,
  detectDuplicateKeys,
} from '../operators/hrCommon.js';
import { normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import { toReconciliationRules } from '../rules/RuleStore.js';
import type { NormalizedDataset, OperatorContext } from '../types.js';

const BANK_ALIASES: FieldAliasMap = {
  transactionId: ['流水号', '交易号', 'transactionId', 'transaction_id', 'id'],
  date: ['日期', '交易日期', 'date', '交易日'],
  amount: ['金额', 'amount'],
  direction: ['方向', '借贷', 'direction', 'debitCredit'],
  counterparty: ['对方', '对手方', 'counterparty', 'payee'],
  summary: ['摘要', 'summary', 'memo', '备注'],
  reference: ['参考号', 'reference', 'referenceNo', 'bankReference'],
  currency: ['币种', 'currency', 'ccy'],
  documentNo: ['单据号', 'documentNo', 'docNo'],
};
const LEDGER_ALIASES: FieldAliasMap = {
  documentNo: ['单据号', '凭证号', 'documentNo', 'document_no', 'voucherNo'],
  date: ['日期', '业务日期', 'date'],
  amount: ['金额', 'amount'],
  direction: ['方向', '借贷', 'direction'],
  counterparty: ['对方', '对手方', 'counterparty', '客户', '供应商'],
  status: ['状态', 'status'],
  reference: ['参考号', 'reference', 'referenceNo', 'bankReference'],
  summary: ['摘要', 'summary', 'memo'],
  currency: ['币种', 'currency', 'ccy'],
};

type NormRow = DataRow & {
  _signed: Decimal;
  _dir: 'IN' | 'OUT' | 'FLAT';
  _date: string | null;
  _abs: Decimal;
  _used: boolean;
  _amountOk: boolean;
  sourceTrace: string;
};

function normSide(ds: NormalizedDataset, role: string, aliases: FieldAliasMap): NormRow[] {
  return normalizeColumns(ds.rows, aliases, {
    role,
    sourceFile: ds.fileName,
    sourceSheet: ds.sheetName,
    inputSha256: ds.sha256,
  }).map((row) => {
    const signed = normalizeSignedMoney(row.amount, row.direction);
    const date = normalizeDate(row.date);
    return {
      ...row,
      _signed: signed.ok ? signed.value : toDecimal(0),
      _dir: signed.ok ? signed.direction : 'FLAT',
      _date: date.ok ? date.value : null,
      _abs: signed.ok ? signed.value.abs() : toDecimal(0),
      _used: false,
      _amountOk: signed.ok,
      sourceTrace: `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`,
    };
  });
}

function refKey(row: DataRow): string {
  return asText(row.reference || row.documentNo || row.transactionId).toLowerCase();
}

function absSum(rows: NormRow[], used: boolean): Decimal {
  return rows.filter((r) => r._used === used).reduce((a, r) => a.plus(r._abs), new Decimal(0));
}

/**
 * FIN-RECONCILIATION-002 — match only; never auto write-off.
 * NOTE: slightly over 350 lines due to exact/scored/subset matching + control totals.
 */
export async function executeFinReconciliation(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('bank_statement') || !ctx.datasets.get('ledger')) {
    throw new Error('bank_statement and ledger are required');
  }
  const rules = toReconciliationRules(ctx.companyRules);
  const tol = toDecimal(rules.amountTolerance);
  const maxSub = Math.min(rules.maxSubsetSize, 4);
  const banks = normSide(ctx.datasets.get('bank_statement')!, 'bank_statement', BANK_ALIASES);
  const ledgers = normSide(ctx.datasets.get('ledger')!, 'ledger', LEDGER_ALIASES);
  const bankDupKeys = new Set(detectDuplicateKeys(banks, ['transactionId']).map((d) => d.key));
  const matched: DataRow[] = [];
  const partial: DataRow[] = [];
  const ambiguous: DataRow[] = [];
  const period = financialPeriod(ctx.runDate, 'MONTH');

  const pushMatch = (bank: NormRow, ledgerRows: NormRow[], status: string, score: number, reason: string) => {
    bank._used = true;
    for (const l of ledgerRows) l._used = true;
    const row: DataRow = {
      bankTransactionId: bank.transactionId,
      bankDate: bank._date ?? '',
      bankAmount: moneyToFixed(bank._signed),
      bankCounterparty: bank.counterparty,
      ledgerDocumentNos: ledgerRows.map((l) => asText(l.documentNo)).join('|'),
      ledgerAmount: moneyToFixed(ledgerRows.reduce((a, l) => a.plus(l._signed), new Decimal(0))),
      matchStatus: status,
      matchScore: Number(score.toFixed(4)),
      matchReason: reason,
      autoWriteOff: false,
      sourceTrace: [bank.sourceTrace, ...ledgerRows.map((l) => l.sourceTrace)].join(';'),
    };
    if (status === 'PARTIAL') partial.push(row);
    else if (status === 'AMBIGUOUS') ambiguous.push(row);
    else matched.push(row);
  };

  for (const bank of banks) {
    if (bank._used) continue;
    if (!bank._amountOk) {
      matched.push({
        bankTransactionId: bank.transactionId,
        matchStatus: 'INVALID',
        matchScore: 0,
        matchReason: 'INVALID_AMOUNT',
        autoWriteOff: false,
        sourceTrace: bank.sourceTrace,
      });
      bank._used = true;
      ctx.exceptions.push({ code: 'INVALID', severity: 'BLOCKING', message: 'Invalid bank amount', row: bank });
      continue;
    }
    if (bankDupKeys.has(asText(bank.transactionId).toLowerCase())) {
      pushMatch(bank, [], 'DUPLICATE', 0, '重复银行流水');
      ctx.exceptions.push({ code: 'DUPLICATE', severity: 'WARNING', message: 'Duplicate bank', row: bank });
      continue;
    }
    const ref = refKey(bank);
    const exactHits = ledgers.filter(
      (l) =>
        !l._used &&
        l._amountOk &&
        l._dir === bank._dir &&
        bank._abs.minus(l._abs).abs().lte(tol) &&
        ref &&
        (refKey(l) === ref || asText(l.documentNo).toLowerCase() === ref),
    );
    if (exactHits.length === 1) {
      pushMatch(bank, [exactHits[0]!], 'EXACT', 1, 'reference+amount+direction');
      continue;
    }
    if (exactHits.length > 1) {
      pushMatch(bank, exactHits.slice(0, 3), 'AMBIGUOUS', 0.5, '多个精确候选');
      ctx.exceptions.push({ code: 'AMBIGUOUS', severity: 'WARNING', message: 'Ambiguous exact', row: bank });
      continue;
    }
    const ccyBank = asText(bank.currency || 'CNY').toUpperCase();
    const ccyClash = ledgers.find(
      (l) => !l._used && ref && refKey(l) === ref && asText(l.currency || 'CNY').toUpperCase() !== ccyBank,
    );
    if (ccyClash) {
      pushMatch(bank, [ccyClash], 'CURRENCY_MISMATCH', 0, '币种不一致');
      ctx.exceptions.push({ code: 'CURRENCY_MISMATCH', severity: 'BLOCKING', message: 'Currency mismatch', row: bank });
      continue;
    }

    const candidates = ledgers
      .filter((l) => !l._used && l._amountOk && l._dir === bank._dir)
      .map((l) => {
        const dateDiff = bank._date && l._date ? Math.abs(daysBetween(bank._date, l._date) ?? 999) : 999;
        return {
          l,
          score: scoredMatch({
            amountDiff: bank._abs.minus(l._abs).abs(),
            dateDiffDays: dateDiff,
            counterpartySimilarity: textSimilarity(bank.counterparty, l.counterparty),
            referenceSimilarity: textSimilarity(
              bank.reference || bank.summary,
              l.reference || l.documentNo || l.summary,
            ),
            amountTolerance: tol,
            dateToleranceDays: rules.dateToleranceDays,
          }),
        };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);

    const strong = candidates.filter((c) => c.score >= 0.55);
    if (strong.length >= 2 && strong[0]!.score - strong[1]!.score < 0.05) {
      pushMatch(bank, strong.slice(0, 2).map((c) => c.l), 'AMBIGUOUS', strong[0]!.score, '分数接近');
      ctx.exceptions.push({ code: 'AMBIGUOUS', severity: 'WARNING', message: 'Ambiguous score', row: bank });
      continue;
    }
    if (candidates[0] && candidates[0].score >= rules.highConfidenceThreshold) {
      pushMatch(bank, [candidates[0].l], 'HIGH_CONFIDENCE', candidates[0].score, 'scored');
      continue;
    }
    if (candidates[0] && candidates[0].score >= 0.55) {
      pushMatch(bank, [candidates[0].l], 'PARTIAL', candidates[0].score, 'scored-partial');
      continue;
    }

    const unusedLedger = ledgers.filter((l) => !l._used && l._amountOk && l._dir === bank._dir).slice(0, 12);
    if (rules.allowOneToMany && unusedLedger.length > 1) {
      const subset = subsetMatchAmounts(bank._abs, unusedLedger.map((l) => l._abs), {
        maxSubsetSize: maxSub,
        tolerance: tol,
      });
      if (subset && subset.length > 1) {
        pushMatch(bank, subset.map((i) => unusedLedger[i]!), 'ONE_TO_MANY', 0.9, 'subset bank→ledgers');
      }
    }
  }

  if (rules.allowManyToOne) {
    for (const ledger of ledgers) {
      if (ledger._used || !ledger._amountOk) continue;
      const unusedBanks = banks.filter((b) => !b._used && b._amountOk && b._dir === ledger._dir).slice(0, 12);
      if (unusedBanks.length < 2) continue;
      const subset = subsetMatchAmounts(ledger._abs, unusedBanks.map((b) => b._abs), {
        maxSubsetSize: maxSub,
        tolerance: tol,
      });
      if (!subset || subset.length <= 1) continue;
      for (const i of subset) unusedBanks[i]!._used = true;
      ledger._used = true;
      matched.push({
        bankTransactionId: subset.map((i) => asText(unusedBanks[i]!.transactionId)).join('|'),
        ledgerDocumentNos: asText(ledger.documentNo),
        bankAmount: moneyToFixed(subset.reduce((a, i) => a.plus(unusedBanks[i]!._signed), new Decimal(0))),
        ledgerAmount: moneyToFixed(ledger._signed),
        matchStatus: 'MANY_TO_ONE',
        matchScore: 0.9,
        matchReason: 'subset banks→ledger',
        autoWriteOff: false,
        sourceTrace: [...subset.map((i) => unusedBanks[i]!.sourceTrace), ledger.sourceTrace].join(';'),
      });
    }
  }

  const unmatchedBank = banks.filter((b) => !b._used).map((b) => ({
    transactionId: b.transactionId,
    date: b._date ?? '',
    amount: moneyToFixed(b._signed),
    counterparty: b.counterparty,
    summary: b.summary,
    matchStatus: 'UNMATCHED_BANK',
    sourceTrace: b.sourceTrace,
  }));
  const unmatchedLedger = ledgers.filter((l) => !l._used).map((l) => ({
    documentNo: l.documentNo,
    date: l._date ?? '',
    amount: moneyToFixed(l._signed),
    counterparty: l.counterparty,
    status: l.status,
    matchStatus: 'UNMATCHED_LEDGER',
    sourceTrace: l.sourceTrace,
  }));
  for (const row of unmatchedBank) {
    ctx.exceptions.push({ code: 'UNMATCHED_BANK', severity: 'WARNING', message: 'Unmatched bank', row });
  }
  for (const row of unmatchedLedger) {
    ctx.exceptions.push({ code: 'UNMATCHED_LEDGER', severity: 'WARNING', message: 'Unmatched ledger', row });
  }

  const bankInputTotal = financialControlTotal(banks.map((b) => ({ amount: moneyToFixed(b._abs) })), 'amount');
  const ledgerInputTotal = financialControlTotal(ledgers.map((l) => ({ amount: moneyToFixed(l._abs) })), 'amount');
  const matchedBankAbs = absSum(banks, true);
  const unmatchedBankAbs = absSum(banks, false);
  const matchedLedgerAbs = absSum(ledgers, true);
  const unmatchedLedgerAbs = absSum(ledgers, false);
  const matchedBankTotal = moneyToFixed(matchedBankAbs);
  const unmatchedBankTotal = moneyToFixed(unmatchedBankAbs);
  const matchedLedgerTotal = moneyToFixed(matchedLedgerAbs);
  const unmatchedLedgerTotal = moneyToFixed(unmatchedLedgerAbs);
  const bankDiff = moneyToFixed(toDecimal(bankInputTotal).minus(matchedBankAbs).minus(unmatchedBankAbs));
  const ledgerDiff = moneyToFixed(toDecimal(ledgerInputTotal).minus(matchedLedgerAbs).minus(unmatchedLedgerAbs));
  const controlRows: DataRow[] = [
    { key: 'bankInputTotal', value: bankInputTotal },
    { key: 'ledgerInputTotal', value: ledgerInputTotal },
    { key: 'matchedBankTotal', value: matchedBankTotal },
    { key: 'unmatchedBankTotal', value: unmatchedBankTotal },
    { key: 'matchedLedgerTotal', value: matchedLedgerTotal },
    { key: 'unmatchedLedgerTotal', value: unmatchedLedgerTotal },
    { key: 'diff.bank', value: bankDiff },
    { key: 'diff.ledger', value: ledgerDiff },
    { key: 'autoWriteOff', value: false },
  ];

  const fileName = renderFileNameTemplate(definition.output.fileNameTemplate || '银行与账务对账_{period}.xlsx', {
    period,
    runDate: ctx.runDate,
  });
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '匹配结果', rows: matched },
      { name: '部分匹配', rows: partial },
      { name: '未匹配银行', rows: unmatchedBank },
      { name: '未匹配账务', rows: unmatchedLedger },
      { name: '歧义候选', rows: ambiguous },
      { name: '控制汇总', rows: controlRows },
      { name: '规则快照', rows: buildRuleSnapshotRows(rules as unknown as Record<string, unknown>) },
      {
        name: '运行说明',
        rows: buildHrRunNotes({
          workflowId: definition.id,
          workflowVersion: ctx.workflowVersion,
          runDate: ctx.runDate,
          rules: rules as unknown as Record<string, unknown>,
          inputSha256ByRole: ctx.inputSha256ByRole,
          inputRowCount: banks.length + ledgers.length,
          outputRowCount: matched.length + partial.length,
          exceptionCount: ctx.exceptions.length,
          extras: [
            { key: 'period', value: period },
            { key: 'control.bankInputTotal', value: bankInputTotal },
            { key: 'control.diff.bank', value: bankDiff },
            { key: 'cloudUpload', value: false },
          ],
        }),
      },
    ],
  });

  const needsReview =
    unmatchedBank.length > 0 ||
    unmatchedLedger.length > 0 ||
    partial.length > 0 ||
    ambiguous.length > 0 ||
    matched.some((r) =>
      ['DUPLICATE', 'CURRENCY_MISMATCH', 'INVALID', 'AMBIGUOUS'].includes(asText(r.matchStatus)),
    );
  ctx.metrics = {
    bankCount: banks.length,
    ledgerCount: ledgers.length,
    matchedCount: matched.length,
    bankInputTotal,
    ledgerInputTotal,
    matchedBankTotal,
    unmatchedBankTotal,
    matchedLedgerTotal,
    unmatchedLedgerTotal,
    diffBank: bankDiff,
    diffLedger: ledgerDiff,
    autoWriteOff: false,
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
