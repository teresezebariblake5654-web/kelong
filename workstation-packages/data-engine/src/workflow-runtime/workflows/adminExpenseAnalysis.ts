import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  financialControlTotal,
  moneyAdd,
  moneyDiv,
  moneySub,
  moneyToFixed,
  normalizeMoney,
  periodFromDate,
  sanitizeAdminSummary,
  toDecimal,
  type Decimal,
} from '../operators/adminCommon.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  buildRuleSnapshotRows,
} from '../operators/hrCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { toAdminExpenseRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const EXPENSE_ALIASES: FieldAliasMap = {
  date: ['日期', '费用日期', 'date', 'expenseDate'],
  department: ['部门', 'department', 'dept'],
  expenseType: ['费用类别', '费用类型', '类别', 'expenseType', 'expense_type', 'type'],
  vendor: ['供应商', 'vendor', '供应商名称'],
  amount: ['金额', 'amount', '费用金额'],
  remark: ['备注', '说明', 'remark', 'note'],
};
const BUDGET_ALIASES: FieldAliasMap = {
  period: ['期间', 'period', '月份'],
  department: ['部门', 'department', 'dept'],
  expenseType: ['费用类别', '费用类型', '类别', 'expenseType', 'type'],
  budgetAmount: ['预算', '预算金额', 'budgetAmount', 'budget'],
};
const HEADCOUNT_ALIASES: FieldAliasMap = {
  period: ['期间', 'period', '月份'],
  department: ['部门', 'department', 'dept'],
  headcount: ['人数', '编制', 'headcount', 'hc'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}
type AggBucket = { amount: Decimal; count: number; traces: string[]; negativeWithoutNote: boolean };
function bucketKey(parts: string[]): string {
  return parts.map((p) => p || '(空白)').join('||');
}

/** ADMIN-EXPENSE-ANALYSIS-002 — analyze only; never auto-disposes exceptions. */
export async function executeAdminExpenseAnalysis(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('admin_expense')) throw new Error('admin_expense is required');
  const rules = toAdminExpenseRules(ctx.companyRules);
  const expDs = ctx.datasets.get('admin_expense')!;
  const expenses = normalizeColumns(expDs.rows, EXPENSE_ALIASES, {
    role: 'admin_expense', sourceFile: expDs.fileName, sourceSheet: expDs.sheetName, inputSha256: expDs.sha256,
  });
  const budgetDs = ctx.datasets.get('budget');
  const budgets = budgetDs
    ? normalizeColumns(budgetDs.rows, BUDGET_ALIASES, {
        role: 'budget', sourceFile: budgetDs.fileName, sourceSheet: budgetDs.sheetName, inputSha256: budgetDs.sha256,
      })
    : [];
  const hcDs = ctx.datasets.get('headcount');
  const headcounts = hcDs
    ? normalizeColumns(hcDs.rows, HEADCOUNT_ALIASES, {
        role: 'headcount', sourceFile: hcDs.fileName, sourceSheet: hcDs.sheetName, inputSha256: hcDs.sha256,
      })
    : [];

  const byDeptTypeVendor = new Map<string, AggBucket>();
  const byDept = new Map<string, AggBucket>();
  const byType = new Map<string, AggBucket>();
  const byVendor = new Map<string, AggBucket>();
  const byPeriodDept = new Map<string, Decimal>();
  let totalAmount = toDecimal(0);

  const bump = (map: Map<string, AggBucket>, key: string, amt: Decimal, row: DataRow, neg: boolean) => {
    const prev = map.get(key) ?? { amount: toDecimal(0), count: 0, traces: [], negativeWithoutNote: false };
    prev.amount = moneyAdd(prev.amount, amt);
    prev.count += 1;
    prev.traces.push(traceOf(row));
    prev.negativeWithoutNote = prev.negativeWithoutNote || neg;
    map.set(key, prev);
  };

  for (const row of expenses) {
    const amt = normalizeMoney(row.amount);
    if (!amt.ok) {
      ctx.exceptions.push({ code: 'INVALID_AMOUNT', severity: 'BLOCKING', message: 'Invalid expense amount', row });
      continue;
    }
    const period = periodFromDate(row.date, rules.period);
    const dept = asText(row.department);
    const type = asText(row.expenseType);
    const vendor = asText(row.vendor);
    if (!period || hasBlank(row.department) || hasBlank(row.expenseType)) {
      ctx.exceptions.push({ code: 'MISSING_DIMENSION', severity: 'WARNING', message: 'Missing period/department/type', row });
    }
    const negativeWithoutNote = amt.value.lt(0) && hasBlank(row.remark);
    if (negativeWithoutNote) {
      ctx.exceptions.push({ code: 'NEGATIVE_WITHOUT_NOTE', severity: 'WARNING', message: 'Negative expense without reversal note', row });
    }
    totalAmount = moneyAdd(totalAmount, amt.value);
    bump(byDeptTypeVendor, bucketKey([period, dept, type, vendor]), amt.value, row, negativeWithoutNote);
    bump(byDept, bucketKey([period, dept]), amt.value, row, negativeWithoutNote);
    bump(byType, bucketKey([period, type]), amt.value, row, negativeWithoutNote);
    bump(byVendor, bucketKey([period, vendor]), amt.value, row, negativeWithoutNote);
    const pdKey = bucketKey([period, dept]);
    byPeriodDept.set(pdKey, moneyAdd(byPeriodDept.get(pdKey) ?? 0, amt.value));
  }

  const budgetMap = new Map<string, Decimal>();
  for (const row of budgets) {
    const period = asText(row.period) || periodFromDate(row.period, rules.period);
    const key = bucketKey([period, asText(row.department), asText(row.expenseType)]);
    const amt = normalizeMoney(row.budgetAmount);
    if (amt.ok) budgetMap.set(key, moneyAdd(budgetMap.get(key) ?? 0, amt.value));
  }
  const hcMap = new Map<string, number>();
  for (const row of headcounts) {
    const key = bucketKey([asText(row.period), asText(row.department)]);
    const n = Number(asText(row.headcount));
    if (Number.isFinite(n)) hcMap.set(key, n);
  }

  const periods = [...new Set([...byDept.keys()].map((k) => k.split('||')[0]!))].sort();
  const prevPeriodOf = (period: string): string | null => {
    const idx = periods.indexOf(period);
    return idx > 0 ? periods[idx - 1]! : null;
  };

  const overview: DataRow[] = [];
  const deptRows: DataRow[] = [];
  const typeRows: DataRow[] = [];
  const vendorRows: DataRow[] = [];
  const budgetDiff: DataRow[] = [];
  const growthRows: DataRow[] = [];

  for (const [key, bucket] of [...byDept.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [period, dept] = key.split('||');
    const hc = hcMap.get(key);
    const perCapita = rules.perCapitaMetrics && hc && hc > 0 ? moneyToFixed(moneyDiv(bucket.amount, hc)) : '';
    const prev = prevPeriodOf(period!);
    const prevAmt = prev ? byPeriodDept.get(bucketKey([prev, dept!])) : undefined;
    let momRate = '';
    let abnormalGrowth = false;
    if (prevAmt && !prevAmt.isZero()) {
      const rate = moneyDiv(moneySub(bucket.amount, prevAmt), prevAmt.abs());
      momRate = moneyToFixed(rate);
      if (rate.abs().gt(rules.materialityRate)) abnormalGrowth = true;
    } else if (prev && totalAmount.gt(0) && moneyDiv(bucket.amount.abs(), totalAmount).gt(rules.materialityRate)) {
      abnormalGrowth = true;
      momRate = 'N/A_NEW';
    }
    const row: DataRow = {
      period, department: dept, amount: moneyToFixed(bucket.amount), lineCount: bucket.count,
      headcount: hc ?? '', perCapitaExpense: perCapita, monthOverMonthRate: momRate,
      status: abnormalGrowth ? 'ABNORMAL_GROWTH' : 'NORMAL', sourceTrace: bucket.traces.slice(0, 5).join('|'),
    };
    deptRows.push(row);
    if (abnormalGrowth) {
      growthRows.push({ ...row, exceptionCodes: 'ABNORMAL_GROWTH' });
      ctx.exceptions.push({ code: 'ABNORMAL_GROWTH', severity: 'WARNING', message: '费用环比异常', row });
    }
  }

  for (const [key, bucket] of [...byType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [period, type] = key.split('||');
    typeRows.push({
      period, expenseType: type, amount: moneyToFixed(bucket.amount), lineCount: bucket.count,
      shareOfTotal: totalAmount.isZero() ? '0.00' : moneyToFixed(moneyDiv(bucket.amount, totalAmount)),
      sourceTrace: bucket.traces.slice(0, 3).join('|'),
    });
  }
  for (const [key, bucket] of [...byVendor.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [period, vendor] = key.split('||');
    const concentration = totalAmount.isZero() ? toDecimal(0) : moneyDiv(bucket.amount, totalAmount);
    const concentrated = concentration.gt(0.4);
    if (concentrated) {
      ctx.exceptions.push({ code: 'VENDOR_CONCENTRATION', severity: 'WARNING', message: '单一供应商集中度过高', row: { period, vendor } });
    }
    vendorRows.push({
      period, vendor, amount: moneyToFixed(bucket.amount), lineCount: bucket.count,
      concentration: moneyToFixed(concentration), status: concentrated ? 'VENDOR_CONCENTRATION' : 'NORMAL',
      sourceTrace: bucket.traces.slice(0, 3).join('|'),
    });
  }

  const actualByDeptType = new Map<string, Decimal>();
  for (const [key, bucket] of byDeptTypeVendor) {
    const [period, dept, type] = key.split('||');
    const dtKey = bucketKey([period!, dept!, type!]);
    actualByDeptType.set(dtKey, moneyAdd(actualByDeptType.get(dtKey) ?? 0, bucket.amount));
  }
  for (const key of [...new Set([...actualByDeptType.keys(), ...budgetMap.keys()])].sort()) {
    const [period, dept, type] = key.split('||');
    const actual = actualByDeptType.get(key) ?? toDecimal(0);
    const budget = budgetMap.get(key);
    if (budget === undefined && budgets.length > 0 && actual.gt(0)) {
      ctx.exceptions.push({ code: 'MISSING_BUDGET', severity: 'INFO', message: '预算缺失', row: { period, department: dept, expenseType: type } });
    }
    const budgetAmt = budget ?? toDecimal(0);
    const variance = moneySub(actual, budgetAmt);
    const varianceRate = budgetAmt.isZero() ? (actual.isZero() ? toDecimal(0) : toDecimal(1)) : moneyDiv(variance, budgetAmt.abs());
    const overBudget = budget !== undefined && variance.gt(0) && varianceRate.gt(rules.materialityRate);
    const row: DataRow = {
      period, department: dept, expenseType: type, amount: moneyToFixed(actual),
      budgetAmount: budget === undefined ? '' : moneyToFixed(budgetAmt),
      budgetVariance: budget === undefined ? '' : moneyToFixed(variance),
      budgetVarianceRate: budget === undefined ? '' : moneyToFixed(varianceRate),
      status: overBudget ? 'OVER_BUDGET' : budget === undefined ? 'MISSING_BUDGET' : 'NORMAL',
    };
    budgetDiff.push(row);
    if (overBudget) ctx.exceptions.push({ code: 'OVER_BUDGET', severity: 'WARNING', message: '超预算', row });
  }

  const periodList = periods.length ? periods : [periodFromDate(ctx.runDate, rules.period)];
  for (const period of periodList) {
    const periodTotal = [...byDept.entries()]
      .filter(([k]) => k.startsWith(`${period}||`))
      .reduce((acc, [, b]) => moneyAdd(acc, b.amount), toDecimal(0));
    overview.push({
      period, totalAmount: moneyToFixed(periodTotal),
      departmentCount: new Set([...byDept.keys()].filter((k) => k.startsWith(`${period}||`)).map((k) => k.split('||')[1])).size,
      vendorCount: new Set([...byVendor.keys()].filter((k) => k.startsWith(`${period}||`)).map((k) => k.split('||')[1])).size,
      controlTotal: moneyToFixed(periodTotal),
    });
  }

  const deptSum = deptRows.reduce((acc, r) => {
    const parsed = normalizeMoney(r.amount);
    return moneyAdd(acc, parsed.ok ? parsed.value : 0);
  }, toDecimal(0));
  const fileName = renderFileNameTemplate(definition.output.fileNameTemplate || '行政费用分析_{period}.xlsx', {
    runDate: ctx.runDate, period: periodList[periodList.length - 1] ?? ctx.runDate.slice(0, 7),
  });
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir, fileName,
    sheets: [
      { name: '费用总览', rows: overview },
      { name: '部门分析', rows: deptRows },
      { name: '类别分析', rows: typeRows },
      { name: '供应商分析', rows: vendorRows },
      { name: '预算差异', rows: budgetDiff },
      { name: '异常增长', rows: growthRows },
      { name: '规则快照', rows: buildRuleSnapshotRows(rules as unknown as Record<string, unknown>) },
      {
        name: '运行说明',
        rows: buildHrRunNotes({
          workflowId: definition.id, workflowVersion: ctx.workflowVersion, runDate: ctx.runDate,
          rules: rules as unknown as Record<string, unknown>, inputSha256ByRole: ctx.inputSha256ByRole,
          inputRowCount: expenses.length, outputRowCount: deptRows.length, exceptionCount: ctx.exceptions.length,
          extras: [
            { key: 'control.totalAmount', value: moneyToFixed(totalAmount) },
            { key: 'control.deptSum', value: moneyToFixed(deptSum) },
            { key: 'autoDispose', value: false },
            { key: 'cloudUpload', value: false },
          ],
        }),
      },
    ],
  });

  ctx.metrics = {
    expenseLineCount: expenses.length, totalAmount: moneyToFixed(totalAmount),
    controlTotal: financialControlTotal(expenses.map((r) => ({ amount: r.amount })), 'amount'),
    abnormalGrowthCount: growthRows.length, autoDispose: false, cloudUpload: false,
  };
  return {
    runId: ctx.runId, workflowId: definition.id, workflowVersion: ctx.workflowVersion,
    status: ctx.exceptions.some((e) => e.severity !== 'INFO') ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath], metrics: ctx.metrics, exceptions: aggregateExceptionCounts(ctx.exceptions),
    aiSummaryPayload: sanitizeAdminSummary({
      workflowId: definition.id, workflowVersion: ctx.workflowVersion, runId: ctx.runId, metrics: { ...ctx.metrics },
    }),
  };
}
