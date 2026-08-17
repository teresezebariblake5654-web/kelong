import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  allocateExpense,
  Decimal,
  financialPeriod,
  moneyAdd,
  moneyDiv,
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
import { toOperatingSummaryRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const REV_ALIASES: FieldAliasMap = {
  date: ['日期', 'date'],
  businessUnit: ['业务单元', '事业部', 'businessUnit', 'bu', 'department'],
  productOrChannel: ['产品', '渠道', 'product', 'channel', 'productOrChannel'],
  revenue: ['收入', 'revenue', 'amount'],
};
const COST_ALIASES: FieldAliasMap = {
  date: ['日期', 'date'],
  businessUnit: ['业务单元', '事业部', 'businessUnit', 'bu'],
  productOrChannel: ['产品', '渠道', 'product', 'channel', 'productOrChannel'],
  cost: ['成本', 'cost', 'amount'],
};
const EXP_ALIASES: FieldAliasMap = {
  date: ['日期', 'date'],
  businessUnit: ['业务单元', '事业部', 'businessUnit', 'bu'],
  expenseType: ['费用类型', 'expenseType', 'type'],
  amount: ['金额', 'amount', 'expense'],
  allocationRatio: ['分摊比例', 'ratio', 'allocationRatio', 'fixedRatio'],
};
const CASH_ALIASES: FieldAliasMap = {
  date: ['日期', 'date'],
  businessUnit: ['业务单元', 'businessUnit', 'bu'],
  amount: ['金额', 'amount'],
};
const BUDGET_ALIASES: FieldAliasMap = {
  period: ['期间', 'period'],
  businessUnit: ['业务单元', 'businessUnit', 'bu'],
  metric: ['指标', 'metric'],
  budgetAmount: ['预算', 'budgetAmount', 'amount'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function sumBy(
  rows: DataRow[],
  keyFields: string[],
  amountField: string,
): Map<string, Decimal> {
  const map = new Map<string, Decimal>();
  for (const row of rows) {
    const key = keyFields.map((f) => asText(row[f]) || '(空白)').join('||');
    const amt = normalizeMoney(row[amountField]);
    if (!amt.ok) continue;
    map.set(key, moneyAdd(map.get(key) ?? 0, amt.value));
  }
  return map;
}

/**
 * FIN-OPERATING-SUMMARY-005 — local operating rollup with expense allocation.
 * NOTE: slightly over 350 lines for multi-dimension rollups + allocation control.
 */
export async function executeFinOperatingSummary(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('revenue') || !ctx.datasets.get('cost') || !ctx.datasets.get('expense')) {
    throw new Error('revenue, cost and expense are required');
  }
  const rules = toOperatingSummaryRules(ctx.companyRules);
  const period = financialPeriod(ctx.runDate, rules.periodMode);

  const norm = (role: string, aliases: FieldAliasMap) => {
    const ds = ctx.datasets.get(role);
    if (!ds) return [] as DataRow[];
    return normalizeColumns(ds.rows, aliases, {
      role,
      sourceFile: ds.fileName,
      sourceSheet: ds.sheetName,
      inputSha256: ds.sha256,
    });
  };

  const revenues = norm('revenue', REV_ALIASES);
  const costs = norm('cost', COST_ALIASES);
  const expenses = norm('expense', EXP_ALIASES);
  const cash = norm('cash_collection', CASH_ALIASES);
  const budgets = norm('budget', BUDGET_ALIASES);

  const revenueByBu = sumBy(revenues, ['businessUnit'], 'revenue');
  const units = [...revenueByBu.entries()].map(([key, weight]) => ({ key, weight }));
  if (units.length === 0) {
    const fromExp = [...new Set(expenses.map((r) => asText(r.businessUnit) || '(空白)'))];
    for (const key of fromExp) units.push({ key, weight: toDecimal(1) });
  }

  const allocationRows: DataRow[] = [];
  let expenseInput = toDecimal(0);
  let allocatedExpenseTotal = toDecimal(0);

  for (const row of expenses) {
    const amt = normalizeMoney(row.amount);
    if (!amt.ok) {
      ctx.exceptions.push({
        code: 'INVALID_AMOUNT',
        severity: 'BLOCKING',
        message: 'Invalid expense amount',
        row,
      });
      continue;
    }
    expenseInput = moneyAdd(expenseInput, amt.value);
    const bu = asText(row.businessUnit);
    const isShared =
      hasBlank(row.businessUnit) || /shared|公共|分摊/i.test(asText(row.expenseType));
    let method: 'DIRECT' | 'REVENUE_SHARE' | 'FIXED_RATIO' = 'DIRECT';
    let allocUnits = [{ key: bu || '(空白)', weight: toDecimal(1) }];
    if (isShared) {
      method =
        rules.allocationMethod === 'FIXED_RATIO'
          ? 'FIXED_RATIO'
          : rules.allocationMethod === 'DIRECT'
            ? 'DIRECT'
            : 'REVENUE_SHARE';
      if (method === 'FIXED_RATIO') {
        allocUnits = (units.length ? units : [{ key: '(空白)', weight: toDecimal(1) }]).map((u) => {
          const ratioRow = expenses.find((e) => asText(e.businessUnit) === u.key);
          const ratio = normalizeMoney(ratioRow?.allocationRatio);
          return { key: u.key, weight: ratio.ok ? ratio.value : toDecimal(1) };
        });
      } else if (method === 'REVENUE_SHARE') {
        allocUnits = units.length ? units : [{ key: '(空白)', weight: toDecimal(1) }];
      } else {
        allocUnits = units.length ? units : [{ key: '(空白)', weight: toDecimal(1) }];
      }
    }

    const allocated = allocateExpense({ amount: amt.value, units: allocUnits, method });
    for (const a of allocated) {
      allocatedExpenseTotal = moneyAdd(allocatedExpenseTotal, a.allocated);
      allocationRows.push({
        expenseType: row.expenseType,
        fromBusinessUnit: bu || '(共享)',
        toBusinessUnit: a.key,
        amount: moneyToFixed(amt.value),
        allocated: moneyToFixed(a.allocated),
        method,
        sourceTrace: traceOf(row),
      });
    }
  }

  const expenseByBu = new Map<string, Decimal>();
  for (const row of allocationRows) {
    const key = asText(row.toBusinessUnit);
    expenseByBu.set(key, moneyAdd(expenseByBu.get(key) ?? 0, row.allocated));
  }
  const costByBu = sumBy(costs, ['businessUnit'], 'cost');
  const cashByBu = sumBy(cash, ['businessUnit'], 'amount');

  const allBus = new Set([
    ...revenueByBu.keys(),
    ...costByBu.keys(),
    ...expenseByBu.keys(),
    ...cashByBu.keys(),
  ]);

  const buRows: DataRow[] = [];
  let totalRevenue = toDecimal(0);
  let totalCost = toDecimal(0);
  let totalExpense = toDecimal(0);
  let totalCash = toDecimal(0);

  for (const bu of [...allBus].sort((a, b) => a.localeCompare(b))) {
    const rev = revenueByBu.get(bu) ?? toDecimal(0);
    const cost = costByBu.get(bu) ?? toDecimal(0);
    const exp = expenseByBu.get(bu) ?? toDecimal(0);
    const cashAmt = cashByBu.get(bu) ?? toDecimal(0);
    totalRevenue = moneyAdd(totalRevenue, rev);
    totalCost = moneyAdd(totalCost, cost);
    totalExpense = moneyAdd(totalExpense, exp);
    totalCash = moneyAdd(totalCash, cashAmt);
    const gross = moneySub(rev, cost);
    const margin = rev.isZero() ? toDecimal(0) : moneyDiv(gross, rev);
    const profit = moneySub(gross, exp);
    buRows.push({
      period,
      businessUnit: bu,
      revenue: moneyToFixed(rev),
      cost: moneyToFixed(cost),
      expense: moneyToFixed(exp),
      grossProfit: moneyToFixed(gross),
      grossMargin: moneyToFixed(margin),
      operatingProfit: moneyToFixed(profit),
      cashCollection: moneyToFixed(cashAmt),
      cashCollectionRate: rev.isZero() ? '0.00' : moneyToFixed(moneyDiv(cashAmt, rev)),
    });
  }

  const revByPc = sumBy(revenues, ['businessUnit', 'productOrChannel'], 'revenue');
  const costByPc = sumBy(costs, ['businessUnit', 'productOrChannel'], 'cost');
  const pcKeys = new Set([...revByPc.keys(), ...costByPc.keys()]);
  const productRows: DataRow[] = [...pcKeys].sort().map((key) => {
    const [bu, pc] = key.split('||');
    const rev = revByPc.get(key) ?? toDecimal(0);
    const cost = costByPc.get(key) ?? toDecimal(0);
    const gross = moneySub(rev, cost);
    return {
      period,
      businessUnit: bu,
      productOrChannel: pc,
      revenue: moneyToFixed(rev),
      cost: moneyToFixed(cost),
      grossProfit: moneyToFixed(gross),
      grossMargin: rev.isZero() ? '0.00' : moneyToFixed(moneyDiv(gross, rev)),
    };
  });

  const overview: DataRow[] = [
    {
      period,
      revenue: moneyToFixed(totalRevenue),
      cost: moneyToFixed(totalCost),
      expense: moneyToFixed(totalExpense),
      grossProfit: moneyToFixed(moneySub(totalRevenue, totalCost)),
      grossMargin: totalRevenue.isZero()
        ? '0.00'
        : moneyToFixed(moneyDiv(moneySub(totalRevenue, totalCost), totalRevenue)),
      operatingProfit: moneyToFixed(moneySub(moneySub(totalRevenue, totalCost), totalExpense)),
      cashCollection: moneyToFixed(totalCash),
      expenseInputTotal: moneyToFixed(expenseInput),
      allocatedExpenseTotal: moneyToFixed(allocatedExpenseTotal),
    },
  ];

  const budgetRows: DataRow[] = [];
  const materialExceptions: DataRow[] = [];
  for (const b of budgets) {
    const metric = asText(b.metric).toLowerCase();
    const bu = asText(b.businessUnit) || '(空白)';
    const budgetAmt = normalizeMoney(b.budgetAmount);
    if (!budgetAmt.ok) continue;
    let actual = toDecimal(0);
    if (metric.includes('revenue') || metric.includes('收入')) {
      actual = revenueByBu.get(bu) ?? totalRevenue;
    } else if (metric.includes('cost') || metric.includes('成本')) {
      actual = costByBu.get(bu) ?? totalCost;
    } else if (metric.includes('expense') || metric.includes('费用')) {
      actual = expenseByBu.get(bu) ?? totalExpense;
    } else if (metric.includes('profit') || metric.includes('利润')) {
      const rev = revenueByBu.get(bu) ?? totalRevenue;
      const cost = costByBu.get(bu) ?? totalCost;
      const exp = expenseByBu.get(bu) ?? totalExpense;
      actual = moneySub(moneySub(rev, cost), exp);
    }
    const variance = moneySub(actual, budgetAmt.value);
    const rate = budgetAmt.value.isZero()
      ? toDecimal(0)
      : moneyDiv(variance, budgetAmt.value.abs());
    const row = {
      period: asText(b.period) || period,
      businessUnit: bu,
      metric: b.metric,
      budgetAmount: moneyToFixed(budgetAmt.value),
      actualAmount: moneyToFixed(actual),
      budgetVariance: moneyToFixed(variance),
      budgetVarianceRate: moneyToFixed(rate),
    };
    budgetRows.push(row);
    if (rate.abs().gte(rules.materialityRate)) {
      materialExceptions.push({ ...row, code: 'MATERIAL_BUDGET_VARIANCE' });
      ctx.exceptions.push({
        code: 'MATERIAL_BUDGET_VARIANCE',
        severity: 'WARNING',
        message: 'Material budget variance',
        row,
      });
    }
  }

  if (!expenseInput.minus(allocatedExpenseTotal).abs().lte('0.01')) {
    materialExceptions.push({
      code: 'ALLOCATION_IMBALANCE',
      expenseInputTotal: moneyToFixed(expenseInput),
      allocatedExpenseTotal: moneyToFixed(allocatedExpenseTotal),
    });
    ctx.exceptions.push({
      code: 'ALLOCATION_IMBALANCE',
      severity: 'BLOCKING',
      message: 'Expense allocation control failed',
    });
  }

  const controlOk = expenseInput.minus(allocatedExpenseTotal).abs().lte('0.01');
  const ruleSnapshot = buildRuleSnapshotRows(rules as unknown as Record<string, unknown>, {
    period,
  });
  const runNotes = buildHrRunNotes({
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    runDate: ctx.runDate,
    rules: rules as unknown as Record<string, unknown>,
    inputSha256ByRole: ctx.inputSha256ByRole,
    inputRowCount: revenues.length + costs.length + expenses.length,
    outputRowCount: buRows.length,
    exceptionCount: ctx.exceptions.length,
    extras: [
      { key: 'period', value: period },
      { key: 'control.expenseInputTotal', value: moneyToFixed(expenseInput) },
      { key: 'control.allocatedExpenseTotal', value: moneyToFixed(allocatedExpenseTotal) },
      { key: 'control.expenseBalanced', value: controlOk },
      { key: 'cloudUpload', value: false },
    ],
  });

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '经营汇总_{period}.xlsx',
    { period, runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '经营总览', rows: overview },
      { name: '业务单元', rows: buRows },
      { name: '产品渠道', rows: productRows },
      { name: '费用分摊', rows: allocationRows },
      { name: '预算差异', rows: budgetRows },
      { name: '重大异常', rows: materialExceptions },
      { name: '规则快照', rows: ruleSnapshot },
      { name: '运行说明', rows: runNotes },
    ],
  });

  ctx.metrics = {
    period,
    revenueTotal: moneyToFixed(totalRevenue),
    costTotal: moneyToFixed(totalCost),
    expenseInputTotal: moneyToFixed(expenseInput),
    allocatedExpenseTotal: moneyToFixed(allocatedExpenseTotal),
    controlBalanced: controlOk,
    cloudUpload: false,
  };

  return {
    runId: ctx.runId,
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    status: ctx.exceptions.length > 0 ? 'NEEDS_REVIEW' : 'COMPLETED',
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
