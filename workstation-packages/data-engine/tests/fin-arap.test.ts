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
  toArapRules,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

async function runArap(options: {
  open: unknown[][];
  payments?: unknown[][];
  rules?: Record<string, unknown>;
  runDate?: string;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-fin-arap-'));
  const openPath = join(dir, 'open.xlsx');
  writeSheet(openPath, options.open);
  const inputFiles: Array<{ role: string; path: string }> = [{ role: 'open_items', path: openPath }];
  if (options.payments) {
    const p = join(dir, 'pay.xlsx');
    writeSheet(p, options.payments);
    inputFiles.push({ role: 'payments', path: p });
  }
  const result = await createWorkflowRuntime().execute({
    workflowId: 'FIN-ARAP-003',
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

describe('FIN-ARAP-003', () => {
  it('normal AR/AP aging and Decimal control', async () => {
    expect(moneyToFixed(moneyAdd('0.1', '0.2'))).toBe('0.30');
    const { result, workbook } = await runArap({
      open: [
        ['单据号', '客商编码', '客商名称', '单据类型', '开票日期', '到期日', '原金额', '未结金额'],
        ['AR1', 'C01', '客户甲', '应收', '2026-06-01', '2026-06-30', '0.1', '0.1'],
        ['AP1', 'S01', '供应商乙', '应付', '2026-06-01', '2026-07-20', '0.2', '0.2'],
      ],
    });
    expect(result.errorMessage).toBeUndefined();
    expect(result.status).toBe('COMPLETED');
    const ar = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['应收账龄']!);
    const ap = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['应付账龄']!);
    expect(ar).toHaveLength(1);
    expect(ap).toHaveLength(1);
    expect(ar[0]!.agingBucket).toBe('1-30');
    expect(result.metrics.controlOpenAmount).toBe('0.30');
    expect(result.outputFiles[0]).toMatch(/应收应付账龄_2026-07-15\.xlsx$/);
  });

  it('missing required role fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-fin-arap-miss-'));
    const result = await createWorkflowRuntime().execute({
      workflowId: 'FIN-ARAP-003',
      inputFiles: [],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-15',
    });
    expect(result.status).toBe('FAILED');
  });

  it('duplicates, negative balance, long overdue → NEEDS_REVIEW', async () => {
    const { result, workbook } = await runArap({
      open: [
        ['单据号', '客商编码', '客商名称', '单据类型', '开票日期', '到期日', '原金额', '未结金额'],
        ['D1', 'C01', '客户甲', 'AR', '2025-01-01', '2025-01-15', 20000, 20000],
        ['D1', 'C01', '客户甲', 'AR', '2025-01-01', '2025-01-15', 20000, 20000],
        ['D2', 'C02', '客户乙', 'AR', '2026-07-01', '2026-07-10', 100, -50],
        ['', 'C03', '客户丙', 'AR', 'bad', 'bad', 'x', 'y'],
      ],
      rules: { longOverdueDays: 180, materialityAmount: '10000' },
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    const codes = new Set(result.exceptions.map((e) => e.code));
    expect(codes.has('DUPLICATE') || codes.has('NEGATIVE_BALANCE') || codes.has('LONG_OVERDUE')).toBe(
      true,
    );
    expect(workbook!.SheetNames).toEqual([
      '应收账龄',
      '应付账龄',
      '催收优先级',
      '付款优先级',
      '异常项目',
      '集中度汇总',
      '规则快照',
      '运行说明',
    ]);
  });

  it('rule defaults and override', () => {
    const defaults = createRuleStore().getDefaults('FIN-ARAP-003');
    expect(defaults.materialityAmount).toBe('10000');
    expect(toArapRules(defaults).longOverdueDays).toBe(180);
    expect(toArapRules({ longOverdueDays: 90 }).longOverdueDays).toBe(90);
  });

  it('fetch=0, AI sanitize, deterministic', async () => {
    let fetchCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return original(...args);
    }) as typeof fetch;
    const open = [
      ['单据号', '客商编码', '客商名称', '单据类型', '开票日期', '到期日', '原金额', '未结金额'],
      ['AR1', 'C01', '客户甲', '应收', '2026-06-01', '2026-07-20', 100, 100],
    ];
    try {
      const a = await runArap({ open });
      const b = await runArap({ open });
      expect(fetchCount).toBe(0);
      expect(a.result.aiSummaryPayload?.rawRows).toBe(false);
      expect(JSON.stringify(a.result.aiSummaryPayload)).not.toContain('客户甲');
      expect(a.result.metrics.controlOpenAmount).toBe(b.result.metrics.controlOpenAmount);
    } finally {
      globalThis.fetch = original;
    }
  });
});
