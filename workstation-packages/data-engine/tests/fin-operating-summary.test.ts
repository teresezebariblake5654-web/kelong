import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createRuleStore,
  createWorkflowRuntime,
  moneyAdd,
  moneyToFixed,
  toOperatingSummaryRules,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

async function runOps(options: {
  revenue: unknown[][];
  cost: unknown[][];
  expense: unknown[][];
  cash?: unknown[][];
  budget?: unknown[][];
  rules?: Record<string, unknown>;
  runDate?: string;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-fin-ops-'));
  const rev = join(dir, 'rev.xlsx');
  const cost = join(dir, 'cost.xlsx');
  const exp = join(dir, 'exp.xlsx');
  writeSheet(rev, options.revenue);
  writeSheet(cost, options.cost);
  writeSheet(exp, options.expense);
  const inputFiles: Array<{ role: string; path: string }> = [
    { role: 'revenue', path: rev },
    { role: 'cost', path: cost },
    { role: 'expense', path: exp },
  ];
  if (options.cash) {
    const p = join(dir, 'cash.xlsx');
    writeSheet(p, options.cash);
    inputFiles.push({ role: 'cash_collection', path: p });
  }
  if (options.budget) {
    const p = join(dir, 'budget.xlsx');
    writeSheet(p, options.budget);
    inputFiles.push({ role: 'budget', path: p });
  }
  const result = await createWorkflowRuntime().execute({
    workflowId: 'FIN-OPERATING-SUMMARY-005',
    inputFiles,
    rules: options.rules,
    outputDir: join(dir, 'out'),
    runDate: options.runDate ?? '2026-07-15',
  });
  const workbook = result.outputFiles[0]
    ? XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' })
    : null;
  return { result, workbook };
}

describe('FIN-OPERATING-SUMMARY-005', () => {
  it('normal rollup with shared expense allocation balanced', async () => {
    expect(moneyToFixed(moneyAdd('0.1', '0.2'))).toBe('0.30');
    const { result, workbook } = await runOps({
      revenue: [
        ['日期', '业务单元', '产品', '收入'],
        ['2026-07-01', 'BU1', 'P1', 100],
        ['2026-07-01', 'BU2', 'P2', 100],
      ],
      cost: [
        ['日期', '业务单元', '产品', '成本'],
        ['2026-07-01', 'BU1', 'P1', 40],
        ['2026-07-01', 'BU2', 'P2', 50],
      ],
      expense: [
        ['日期', '业务单元', '费用类型', '金额'],
        ['2026-07-01', 'BU1', '差旅', '0.1'],
        ['2026-07-01', '', '公共费用', '0.2'],
      ],
      rules: { allocationMethod: 'REVENUE_SHARE' },
    });
    expect(result.errorMessage).toBeUndefined();
    expect(result.metrics.controlBalanced).toBe(true);
    expect(result.metrics.expenseInputTotal).toBe(result.metrics.allocatedExpenseTotal);
    expect(result.metrics.expenseInputTotal).toBe('0.30');
    const overview = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['经营总览']!);
    expect(overview[0]!.grossProfit).toBe('110.00');
    expect(result.outputFiles[0]).toMatch(/经营汇总_2026-07\.xlsx$/);
  });

  it('missing required role fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-fin-ops-miss-'));
    const rev = join(dir, 'rev.xlsx');
    writeSheet(rev, [['日期', '业务单元', '产品', '收入'], ['2026-07-01', 'BU1', 'P1', 1]]);
    const result = await createWorkflowRuntime().execute({
      workflowId: 'FIN-OPERATING-SUMMARY-005',
      inputFiles: [{ role: 'revenue', path: rev }],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-15',
    });
    expect(result.status).toBe('FAILED');
  });

  it('material budget variance → NEEDS_REVIEW and sheets', async () => {
    const { result, workbook } = await runOps({
      revenue: [
        ['日期', '业务单元', '产品', '收入'],
        ['2026-07-01', 'BU1', 'P1', 100],
      ],
      cost: [
        ['日期', '业务单元', '产品', '成本'],
        ['2026-07-01', 'BU1', 'P1', 40],
      ],
      expense: [
        ['日期', '业务单元', '费用类型', '金额'],
        ['2026-07-01', 'BU1', '差旅', 10],
      ],
      budget: [
        ['期间', '业务单元', '指标', '预算'],
        ['2026-07', 'BU1', 'revenue', 50],
      ],
      rules: { materialityRate: 0.1 },
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.some((e) => e.code === 'MATERIAL_BUDGET_VARIANCE')).toBe(true);
    expect(workbook!.SheetNames).toEqual([
      '经营总览',
      '业务单元',
      '产品渠道',
      '费用分摊',
      '预算差异',
      '重大异常',
      '规则快照',
      '运行说明',
    ]);
  });

  it('rule defaults and override', () => {
    const defaults = createRuleStore().getDefaults('FIN-OPERATING-SUMMARY-005');
    expect(defaults.periodMode).toBe('MONTH');
    expect(toOperatingSummaryRules(defaults).allocationMethod).toBe('REVENUE_SHARE');
    expect(toOperatingSummaryRules({ allocationMethod: 'DIRECT' }).allocationMethod).toBe('DIRECT');
  });

  it('invalid expense amount exception', async () => {
    const { result } = await runOps({
      revenue: [['日期', '业务单元', '产品', '收入'], ['2026-07-01', 'BU1', 'P1', 10]],
      cost: [['日期', '业务单元', '产品', '成本'], ['2026-07-01', 'BU1', 'P1', 1]],
      expense: [['日期', '业务单元', '费用类型', '金额'], ['2026-07-01', 'BU1', '差旅', 'abc']],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.some((e) => e.code === 'INVALID_AMOUNT')).toBe(true);
  });

  it('fetch=0, AI sanitize, deterministic', async () => {
    let fetchCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return original(...args);
    }) as typeof fetch;
    const input = {
      revenue: [['日期', '业务单元', '产品', '收入'], ['2026-07-01', 'BU1', 'P1', 100]],
      cost: [['日期', '业务单元', '产品', '成本'], ['2026-07-01', 'BU1', 'P1', 40]],
      expense: [['日期', '业务单元', '费用类型', '金额'], ['2026-07-01', 'BU1', '差旅', 10]],
    };
    try {
      const a = await runOps(input);
      const b = await runOps(input);
      expect(fetchCount).toBe(0);
      expect(a.result.aiSummaryPayload?.rawRows).toBe(false);
      expect(a.result.metrics.revenueTotal).toBe(b.result.metrics.revenueTotal);
      expect(a.result.metrics.cloudUpload).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});
