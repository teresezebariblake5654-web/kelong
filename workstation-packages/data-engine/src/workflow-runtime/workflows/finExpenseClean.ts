import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  accountMapping,
  fuzzyDuplicateTransaction,
  financialControlTotal,
  moneyAdd,
  moneySub,
  moneyToFixed,
  normalizeMoney,
  sanitizeFinancialSummary,
  toDecimal,
} from '../operators/financeCommon.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  buildRuleSnapshotRows,
} from '../operators/hrCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import { toExpenseCleanRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const EXPENSE_ALIASES: FieldAliasMap = {
  expenseId: ['费用编号', '报销单号', 'expense_id', 'expenseId', 'id'],
  date: ['日期', '费用日期', 'expense_date', 'date'],
  employeeOrVendor: ['报销人', '供应商', 'employee', 'vendor', 'employeeOrVendor', 'party'],
  amount: ['金额', '不含税金额', 'amount', 'netAmount'],
  tax: ['税额', 'tax', 'taxAmount'],
  description: ['摘要', '说明', 'description', 'memo'],
  expenseType: ['费用类型', '费用类别', 'expense_type', 'expenseType', 'type'],
  documentType: ['单据类型', 'document_type', 'documentType'],
  receiptAttached: ['有票', '发票附件', 'receipt', 'receiptAttached', 'hasReceipt'],
  referenceNote: ['冲销说明', '负数说明', 'reference', 'referenceNote'],
  limitAmount: ['标准金额', '限额', 'limit', 'limitAmount'],
  accountCode: ['科目', '科目代码', 'account', 'accountCode'],
  invoiceNo: ['发票号', '发票号码', 'invoiceNo', 'invoiceNumber'],
};
const POLICY_ALIASES: FieldAliasMap = {
  expenseType: ['费用类型', '费用类别', 'expense_type', 'expenseType', 'type'],
  limitAmount: ['标准金额', '限额', 'limit', 'limitAmount'],
  receiptRequired: ['需要发票', '必须有票', 'receiptRequired', 'receipt_required'],
};
const MAPPING_ALIASES: FieldAliasMap = {
  keyword: ['关键词', 'keyword', '关键字'],
  expenseType: ['费用类型', 'expenseType', 'expense_type'],
  documentType: ['单据类型', 'documentType', 'document_type'],
  accountCode: ['科目', '科目代码', 'accountCode', 'account'],
  department: ['部门', 'department'],
  project: ['项目', 'project'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function truthy(value: unknown): boolean {
  const t = asText(value).toLowerCase();
  return ['1', 'true', 'yes', 'y', '是', '有', 'true'].includes(t) || t === '有票';
}

function pickStatus(codes: string[]): string {
  const order = [
    'MISSING_REQUIRED_FIELD',
    'INVALID_AMOUNT',
    'INVALID_DATE',
    'NEGATIVE_WITHOUT_REFERENCE',
    'DUPLICATE_SUSPECTED',
    'OVER_LIMIT',
    'MISSING_RECEIPT',
    'MAPPING_CONFLICT',
    'UNMAPPED_ACCOUNT',
  ];
  for (const code of order) if (codes.includes(code)) return code;
  return 'READY';
}

/** FIN-EXPENSE-CLEAN-001 — local expense clean; never posts or pays. */
export async function executeFinExpenseClean(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('expense')) throw new Error('expense is required');
  const rules = toExpenseCleanRules(ctx.companyRules);
  const expenseDs = ctx.datasets.get('expense')!;
  const expenses = normalizeColumns(expenseDs.rows, EXPENSE_ALIASES, {
    role: 'expense',
    sourceFile: expenseDs.fileName,
    sourceSheet: expenseDs.sheetName,
    inputSha256: expenseDs.sha256,
  });
  const policyDs = ctx.datasets.get('expense_policy');
  const policies = policyDs
    ? normalizeColumns(policyDs.rows, POLICY_ALIASES, {
        role: 'expense_policy',
        sourceFile: policyDs.fileName,
        sourceSheet: policyDs.sheetName,
        inputSha256: policyDs.sha256,
      })
    : [];
  const mappingDs = ctx.datasets.get('mapping');
  const mappings = mappingDs
    ? normalizeColumns(mappingDs.rows, MAPPING_ALIASES, {
        role: 'mapping',
        sourceFile: mappingDs.fileName,
        sourceSheet: mappingDs.sheetName,
        inputSha256: mappingDs.sha256,
      })
    : [];

  const policyByType = new Map<string, DataRow>();
  for (const row of policies) {
    const key = asText(row.expenseType).toLowerCase();
    if (key) policyByType.set(key, row);
  }

  const withTotals: DataRow[] = expenses.map((row) => {
    const amount = normalizeMoney(row.amount);
    const tax = normalizeMoney(row.tax ?? 0);
    const total =
      amount.ok && tax.ok
        ? moneyAdd(amount.value, tax.ok ? tax.value : 0)
        : amount.ok
          ? amount.value
          : null;
    return {
      ...row,
      totalAmount: total ? moneyToFixed(total) : '',
      _amountOk: amount.ok,
      _taxOk: tax.ok || hasBlank(row.tax),
    };
  });

  const dups = fuzzyDuplicateTransaction({
    rows: withTotals,
    windowDays: rules.duplicateWindowDays,
    amountTolerance: toDecimal(rules.amountTolerance),
  });
  const dupIndexes = new Set<number>();
  const dupMeta = new Map<number, { score: number; reason: string; peer: number }>();
  for (const d of dups) {
    dupIndexes.add(d.leftIndex);
    dupIndexes.add(d.rightIndex);
    dupMeta.set(d.leftIndex, { score: d.score, reason: d.reason, peer: d.rightIndex });
    dupMeta.set(d.rightIndex, { score: d.score, reason: d.reason, peer: d.leftIndex });
  }

  const detail: DataRow[] = [];
  for (let i = 0; i < withTotals.length; i += 1) {
    const row = withTotals[i]!;
    const codes: string[] = [];
    const sourceTrace = traceOf(row);
    if (
      hasBlank(row.expenseId) ||
      hasBlank(row.employeeOrVendor) ||
      hasBlank(row.description) ||
      hasBlank(row.amount)
    ) {
      codes.push('MISSING_REQUIRED_FIELD');
    }
    const amount = normalizeMoney(row.amount);
    const tax = normalizeMoney(row.tax ?? 0);
    if (!amount.ok) codes.push('INVALID_AMOUNT');
    const date = normalizeDate(row.date);
    if (!date.ok) codes.push('INVALID_DATE');
    if (amount.ok && amount.value.isNegative() && hasBlank(row.referenceNote)) {
      codes.push('NEGATIVE_WITHOUT_REFERENCE');
    }
    if (dupIndexes.has(i)) codes.push('DUPLICATE_SUSPECTED');

    const policy = policyByType.get(asText(row.expenseType).toLowerCase());
    const limitRaw = row.limitAmount ?? policy?.limitAmount;
    const limit = normalizeMoney(limitRaw);
    const total = amount.ok ? moneyAdd(amount.value, tax.ok ? tax.value : 0) : null;
    let overLimit = '0.00';
    if (total && limit.ok && total.gt(limit.value)) {
      codes.push('OVER_LIMIT');
      overLimit = moneyToFixed(moneySub(total, limit.value));
    }

    const needReceipt =
      policy?.receiptRequired !== undefined
        ? truthy(policy.receiptRequired)
        : rules.receiptRequired;
    if (needReceipt && !truthy(row.receiptAttached)) codes.push('MISSING_RECEIPT');

    const mapped = accountMapping({
      expenseType: row.expenseType,
      documentType: row.documentType,
      description: row.description,
      mappingRows: mappings,
      defaultAccount: rules.defaultAccount,
    });
    if (mapped.conflict) codes.push('MAPPING_CONFLICT');
    else if (!mapped.accountCode) codes.push('UNMAPPED_ACCOUNT');
    else if (mapped.source === 'DEFAULT' && mappings.length > 0 && !asText(row.accountCode)) {
      // default used because no mapping hit — still ready unless no default
    }
    if (!mapped.accountCode && !rules.defaultAccount) codes.push('UNMAPPED_ACCOUNT');

    const status = pickStatus(codes);
    for (const code of codes) {
      ctx.exceptions.push({
        code,
        severity: code === 'DUPLICATE_SUSPECTED' || code === 'OVER_LIMIT' ? 'WARNING' : 'BLOCKING',
        message: code,
        row: { expenseId: row.expenseId },
      });
    }
    const meta = dupMeta.get(i);
    detail.push({
      expenseId: row.expenseId,
      date: date.ok ? date.value : asText(row.date),
      employeeOrVendor: row.employeeOrVendor,
      expenseType: row.expenseType,
      description: row.description,
      amount: amount.ok ? moneyToFixed(amount.value) : asText(row.amount),
      tax: tax.ok ? moneyToFixed(tax.value) : moneyToFixed(0),
      totalAmount: total ? moneyToFixed(total) : '',
      accountCode: mapped.accountCode || asText(row.accountCode),
      accountSource: mapped.source,
      overLimitAmount: overLimit,
      receiptAttached: truthy(row.receiptAttached),
      duplicateScore: meta?.score ?? '',
      duplicateReason: meta?.reason ?? '',
      status,
      exceptionCodes: codes.join('|'),
      sourceTrace,
    });
  }

  const standard = detail.filter((r) => asText(r.status) === 'READY');
  const duplicates = detail.filter((r) => asText(r.status) === 'DUPLICATE_SUSPECTED' || asText(r.exceptionCodes).includes('DUPLICATE_SUSPECTED'));
  const overLimit = detail.filter((r) => asText(r.exceptionCodes).includes('OVER_LIMIT'));
  const missingReceipt = detail.filter((r) => asText(r.exceptionCodes).includes('MISSING_RECEIPT'));
  const pendingAccount = detail.filter(
    (r) =>
      asText(r.exceptionCodes).includes('UNMAPPED_ACCOUNT') ||
      asText(r.exceptionCodes).includes('MAPPING_CONFLICT'),
  );

  const controlTotalAmount = financialControlTotal(detail, 'totalAmount');
  const ruleSnapshot = buildRuleSnapshotRows(rules as unknown as Record<string, unknown>, {
    cloudUpload: false,
    autoPosting: false,
  });
  const runNotes = buildHrRunNotes({
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    runDate: ctx.runDate,
    rules: rules as unknown as Record<string, unknown>,
    inputSha256ByRole: ctx.inputSha256ByRole,
    inputRowCount: expenses.length,
    outputRowCount: detail.length,
    exceptionCount: ctx.exceptions.length,
    extras: [
      { key: 'control.totalAmount', value: controlTotalAmount },
      { key: 'cloudUpload', value: false },
    ],
  });

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '费用整理结果_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '标准费用明细', rows: detail },
      { name: '重复费用', rows: duplicates },
      { name: '超标准', rows: overLimit },
      { name: '缺票清单', rows: missingReceipt },
      { name: '待分科目', rows: pendingAccount },
      { name: '规则快照', rows: ruleSnapshot },
      { name: '运行说明', rows: runNotes },
    ],
  });

  const nonReady = detail.some((r) => asText(r.status) !== 'READY');
  ctx.metrics = {
    expenseCount: detail.length,
    readyCount: standard.length,
    duplicateCount: duplicates.length,
    controlTotalAmount,
    cloudUpload: false,
    localExecution: true,
  };

  return {
    runId: ctx.runId,
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    status: nonReady ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath],
    metrics: ctx.metrics,
    exceptions: aggregateExceptionCounts(ctx.exceptions),
    aiSummaryPayload: sanitizeFinancialSummary({
      workflowId: definition.id,
      workflowVersion: ctx.workflowVersion,
      runId: ctx.runId,
      metrics: {
        expenseCount: detail.length,
        readyCount: standard.length,
        duplicateCount: duplicates.length,
        controlTotalAmount,
        exceptionByCode: aggregateExceptionCounts(ctx.exceptions).map((e) => ({
          code: e.code,
          count: e.count,
          severity: e.severity,
        })),
      },
    }),
  };
}
