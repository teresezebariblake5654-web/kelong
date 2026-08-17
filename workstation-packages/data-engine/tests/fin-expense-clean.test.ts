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
  toExpenseCleanRules,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

async function runExpense(options: {
  expense: unknown[][];
  policy?: unknown[][];
  mapping?: unknown[][];
  rules?: Record<string, unknown>;
  runDate?: string;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-fin-exp-'));
  const expensePath = join(dir, 'expense.xlsx');
  writeSheet(expensePath, options.expense);
  const inputFiles: Array<{ role: string; path: string }> = [{ role: 'expense', path: expensePath }];
  if (options.policy) {
    const p = join(dir, 'policy.xlsx');
    writeSheet(p, options.policy);
    inputFiles.push({ role: 'expense_policy', path: p });
  }
  if (options.mapping) {
    const p = join(dir, 'map.xlsx');
    writeSheet(p, options.mapping);
    inputFiles.push({ role: 'mapping', path: p });
  }
  const result = await createWorkflowRuntime().execute({
    workflowId: 'FIN-EXPENSE-CLEAN-001',
    inputFiles,
    rules: options.rules,
    outputDir: join(dir, 'out'),
    runDate: options.runDate ?? '2026-07-15',
  });
  const workbook = result.outputFiles[0]
    ? XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' })
    : null;
  return { result, workbook, dir };
}

const normalExpense = [
  ['费用编号', '日期', '报销人', '金额', '税额', '说明', '费用类型', '有票'],
  ['EX001', '2026-07-10', '张三', '0.1', '0.2', '差旅住宿', '差旅', '是'],
];

describe('FIN-EXPENSE-CLEAN-001', () => {
  it('normal case totals amount+tax with Decimal precision', async () => {
    expect(moneyToFixed(moneyAdd('0.1', '0.2'))).toBe('0.30');
    const { result, workbook } = await runExpense({
      expense: normalExpense,
      mapping: [
        ['关键词', '科目代码'],
        ['差旅', '6602'],
      ],
    });
    expect(result.errorMessage).toBeUndefined();
    expect(result.status).toBe('COMPLETED');
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['标准费用明细']!);
    expect(rows[0]!.totalAmount).toBe('0.30');
    expect(rows[0]!.status).toBe('READY');
    expect(rows[0]!.sourceTrace).toBeTruthy();
  });

  it('fails on missing required role', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-fin-exp-miss-'));
    const result = await createWorkflowRuntime().execute({
      workflowId: 'FIN-EXPENSE-CLEAN-001',
      inputFiles: [],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-15',
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toMatch(/Missing required input role/);
  });

  it('flags duplicate and missing fields as NEEDS_REVIEW', async () => {
    const { result, workbook } = await runExpense({
      expense: [
        ['费用编号', '日期', '报销人', '金额', '税额', '说明', '费用类型', '有票'],
        ['EX001', '2026-07-10', '张三', 100, 0, '餐费', '餐饮', '是'],
        ['EX002', '2026-07-11', '张三', 100, 0, '餐费', '餐饮', '是'],
        ['', '2026-07-12', '', 'x', 0, '', '餐饮', '否'],
      ],
      policy: [
        ['费用类型', '标准金额', '需要发票'],
        ['餐饮', 50, '是'],
      ],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.some((e) => e.code === 'DUPLICATE_SUSPECTED')).toBe(true);
    expect(result.exceptions.some((e) => e.code === 'MISSING_REQUIRED_FIELD' || e.code === 'OVER_LIMIT' || e.code === 'MISSING_RECEIPT')).toBe(true);
    expect(workbook!.SheetNames).toEqual([
      '标准费用明细',
      '重复费用',
      '超标准',
      '缺票清单',
      '待分科目',
      '规则快照',
      '运行说明',
    ]);
  });

  it('applies rule defaults and overrides', async () => {
    const defaults = createRuleStore().getDefaults('FIN-EXPENSE-CLEAN-001');
    expect(defaults.duplicateWindowDays).toBe(3);
    expect(defaults.defaultAccount).toBe('6602');
    expect(toExpenseCleanRules(defaults).receiptRequired).toBe(true);
    const { workbook } = await runExpense({
      expense: [
        ['费用编号', '日期', '报销人', '金额', '说明', '费用类型', '有票'],
        ['EX010', '2026-07-10', '李四', 20, '办公用品', '办公', '否'],
      ],
      rules: { receiptRequired: false, defaultAccount: '6601' },
    });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['标准费用明细']!);
    expect(rows[0]!.accountCode).toBe('6601');
    expect(String(rows[0]!.exceptionCodes)).not.toContain('MISSING_RECEIPT');
  });

  it('control totals and output path pattern', async () => {
    const { result, workbook } = await runExpense({ expense: normalExpense });
    expect(result.outputFiles[0]).toMatch(/费用整理结果_2026-07-15\.xlsx$/);
    expect(result.metrics.controlTotalAmount).toBe('0.30');
    const notes = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['运行说明']!);
    expect(notes.some((r) => String(r.key).startsWith('inputSha256'))).toBe(true);
  });

  it('fetch=0, AI sanitized, deterministic double-run', async () => {
    let fetchCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return original(...args);
    }) as typeof fetch;
    try {
      const a = await runExpense({ expense: normalExpense });
      const b = await runExpense({ expense: normalExpense });
      expect(fetchCount).toBe(0);
      expect(a.result.aiSummaryPayload?.rawRows).toBe(false);
      expect(JSON.stringify(a.result.aiSummaryPayload)).not.toContain('张三');
      expect(a.result.metrics.controlTotalAmount).toBe(b.result.metrics.controlTotalAmount);
      expect(a.result.metrics.cloudUpload).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});
