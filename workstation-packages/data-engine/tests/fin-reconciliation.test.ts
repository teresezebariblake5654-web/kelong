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
  toReconciliationRules,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

async function runRec(options: {
  bank: unknown[][];
  ledger: unknown[][];
  rules?: Record<string, unknown>;
  runDate?: string;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-fin-rec-'));
  const bankPath = join(dir, 'bank.xlsx');
  const ledgerPath = join(dir, 'ledger.xlsx');
  writeSheet(bankPath, options.bank);
  writeSheet(ledgerPath, options.ledger);
  const result = await createWorkflowRuntime().execute({
    workflowId: 'FIN-RECONCILIATION-002',
    inputFiles: [
      { role: 'bank_statement', path: bankPath },
      { role: 'ledger', path: ledgerPath },
    ],
    rules: options.rules,
    outputDir: join(dir, 'out'),
    runDate: options.runDate ?? '2026-07-15',
  });
  const workbook = result.outputFiles[0]
    ? XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' })
    : null;
  return { result, workbook };
}

describe('FIN-RECONCILIATION-002', () => {
  it('exact match and closed control totals', async () => {
    expect(moneyToFixed(moneyAdd('0.1', '0.2'))).toBe('0.30');
    const { result, workbook } = await runRec({
      bank: [
        ['流水号', '日期', '金额', '方向', '对方', '摘要', '参考号'],
        ['B1', '2026-07-10', '0.1', 'IN', '客户A', '收款', 'R001'],
        ['B2', '2026-07-11', '0.2', 'IN', '客户A', '收款', 'R002'],
      ],
      ledger: [
        ['单据号', '日期', '金额', '方向', '对方', '状态', '参考号'],
        ['L1', '2026-07-10', '0.1', 'IN', '客户A', 'OPEN', 'R001'],
        ['L2', '2026-07-11', '0.2', 'IN', '客户A', 'OPEN', 'R002'],
      ],
    });
    expect(result.errorMessage).toBeUndefined();
    expect(result.status).toBe('COMPLETED');
    expect(result.metrics.diffBank).toBe('0.00');
    expect(result.metrics.diffLedger).toBe('0.00');
    expect(result.metrics.autoWriteOff).toBe(false);
    const matched = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['匹配结果']!);
    expect(matched.every((r) => r.matchStatus === 'EXACT')).toBe(true);
    expect(matched.every((r) => r.autoWriteOff === false || r.autoWriteOff === 'false')).toBe(true);
  });

  it('missing role fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-fin-rec-miss-'));
    const bank = join(dir, 'bank.xlsx');
    writeSheet(bank, [['流水号', '日期', '金额'], ['B1', '2026-07-10', 10]]);
    const result = await createWorkflowRuntime().execute({
      workflowId: 'FIN-RECONCILIATION-002',
      inputFiles: [{ role: 'bank_statement', path: bank }],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-15',
    });
    expect(result.status).toBe('FAILED');
  });

  it('unmatched and NEEDS_REVIEW with sheet names', async () => {
    const { result, workbook } = await runRec({
      bank: [
        ['流水号', '日期', '金额', '方向', '对方', '摘要', '参考号'],
        ['B1', '2026-07-10', 100, 'IN', '客户A', '收款', 'R001'],
        ['B9', '2026-07-12', 50, 'IN', '客户B', '收款', 'RX'],
      ],
      ledger: [
        ['单据号', '日期', '金额', '方向', '对方', '状态', '参考号'],
        ['L1', '2026-07-10', 100, 'IN', '客户A', 'OPEN', 'R001'],
        ['L9', '2026-07-13', 80, 'IN', '客户C', 'OPEN', 'RY'],
      ],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(workbook!.SheetNames).toEqual([
      '匹配结果',
      '部分匹配',
      '未匹配银行',
      '未匹配账务',
      '歧义候选',
      '控制汇总',
      '规则快照',
      '运行说明',
    ]);
    expect(result.outputFiles[0]).toMatch(/银行与账务对账_2026-07\.xlsx$/);
  });

  it('rule defaults and override highConfidenceThreshold', () => {
    const defaults = createRuleStore().getDefaults('FIN-RECONCILIATION-002');
    expect(defaults.dateToleranceDays).toBe(3);
    expect(defaults.allowManyToOne).toBe(true);
    expect(toReconciliationRules(defaults).maxSubsetSize).toBe(4);
    expect(toReconciliationRules({ highConfidenceThreshold: 0.9 }).highConfidenceThreshold).toBe(0.9);
  });

  it('one-to-many subset and control totals', async () => {
    const { result, workbook } = await runRec({
      bank: [
        ['流水号', '日期', '金额', '方向', '对方', '摘要', '参考号'],
        ['B1', '2026-07-10', 300, 'IN', '客户A', '合并收款', ''],
      ],
      ledger: [
        ['单据号', '日期', '金额', '方向', '对方', '状态', '参考号'],
        ['L1', '2026-07-10', 100, 'IN', '客户A', 'OPEN', ''],
        ['L2', '2026-07-10', 200, 'IN', '客户A', 'OPEN', ''],
      ],
      rules: { allowOneToMany: true, maxSubsetSize: 4 },
    });
    const matched = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['匹配结果']!);
    expect(matched.some((r) => r.matchStatus === 'ONE_TO_MANY')).toBe(true);
    expect(result.metrics.matchedBankTotal).toBe('300.00');
    expect(result.metrics.unmatchedBankTotal).toBe('0.00');
    expect(result.metrics.diffBank).toBe('0.00');
  });

  it('fetch=0, AI sanitize, deterministic', async () => {
    let fetchCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return original(...args);
    }) as typeof fetch;
    const input = {
      bank: [
        ['流水号', '日期', '金额', '方向', '对方', '摘要', '参考号'],
        ['B1', '2026-07-10', '0.1', 'IN', '客户A', '收款', 'R001'],
      ],
      ledger: [
        ['单据号', '日期', '金额', '方向', '对方', '状态', '参考号'],
        ['L1', '2026-07-10', '0.1', 'IN', '客户A', 'OPEN', 'R001'],
      ],
    };
    try {
      const a = await runRec(input);
      const b = await runRec(input);
      expect(fetchCount).toBe(0);
      expect(a.result.aiSummaryPayload?.rawRows).toBe(false);
      expect(JSON.stringify(a.result.aiSummaryPayload)).not.toContain('客户A');
      expect(a.result.metrics.matchedBankTotal).toBe(b.result.metrics.matchedBankTotal);
    } finally {
      globalThis.fetch = original;
    }
  });
});
