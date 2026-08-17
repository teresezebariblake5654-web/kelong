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
  toRefundRules,
  refundRemaining,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

async function runRefund(options: {
  orders: unknown[][];
  refunds: unknown[][];
  returns?: unknown[][];
  rules?: Record<string, unknown>;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-ecom-ref-'));
  const orders = join(dir, 'orders.xlsx');
  const refunds = join(dir, 'refunds.xlsx');
  writeSheet(orders, options.orders);
  writeSheet(refunds, options.refunds);
  const inputFiles: Array<{ role: string; path: string }> = [
    { role: 'orders', path: orders },
    { role: 'refunds', path: refunds },
  ];
  if (options.returns) {
    const p = join(dir, 'returns.xlsx');
    writeSheet(p, options.returns);
    inputFiles.push({ role: 'returns', path: p });
  }
  const result = await createWorkflowRuntime().execute({
    workflowId: 'ECOM-REFUND-002',
    inputFiles,
    rules: options.rules,
    outputDir: join(dir, 'out'),
    runDate: '2026-07-20',
  });
  const workbook = result.outputFiles[0]
    ? XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' })
    : null;
  return { result, workbook };
}

describe('ECOM-REFUND-002', () => {
  it('cumulative refund remaining with decimal precision', async () => {
    expect(moneyToFixed(moneyAdd('0.1', '0.2'))).toBe('0.30');
    const rem = refundRemaining('100.00', '30.00');
    expect(rem.ok && moneyToFixed(rem.remaining)).toBe('70.00');

    const { result, workbook } = await runRefund({
      orders: [
        ['订单号', '实付', '支付方式', '发货状态'],
        ['O1', '100.00', '支付宝', '已发货'],
      ],
      refunds: [
        ['退款单号', '订单号', '退款金额', '退款时间', '退款状态', '退款原因'],
        ['R1', 'O1', '0.1', '2026-07-18', '完成', '质量问题'],
        ['R2', 'O1', '0.2', '2026-07-19', '完成', '质量问题'],
      ],
      returns: [
        ['退货单号', '订单号', 'SKU', '退货数量', '入库状态'],
        ['T1', 'O1', 'S1', 1, '已入库'],
      ],
    });
    expect(result.errorMessage).toBeUndefined();
    expect(result.status).toBe('COMPLETED');
    expect(result.metrics.autoRefund).toBe(false);
    expect(result.outputFiles[0]).toMatch(/退款异常核对_2026-07-20\.xlsx$/);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['退款总表']!);
    expect(rows[0]!.totalRefunded).toBe('0.30');
    expect(workbook!.SheetNames).toEqual(
      expect.arrayContaining(['退款总表', '超额重复退款', '已入库未退款', '运行说明']),
    );
  });

  it('missing role fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-ecom-ref-miss-'));
    const result = await createWorkflowRuntime().execute({
      workflowId: 'ECOM-REFUND-002',
      inputFiles: [],
      outputDir: join(dir, 'out'),
    });
    expect(result.status).toBe('FAILED');
  });

  it('over-refund by cumulative sum → NEEDS_REVIEW', async () => {
    const { result, workbook } = await runRefund({
      orders: [
        ['订单号', '实付', '支付方式', '发货状态'],
        ['O2', '50', '微信', '已发货'],
      ],
      refunds: [
        ['退款单号', '订单号', '退款金额', '退款时间', '退款状态', '退款原因'],
        ['R9', 'O2', '30', '2026-07-01', '完成', '质量问题'],
        ['R10', 'O2', '40', '2026-07-02', '完成', '质量问题'],
      ],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.some((e) => e.code === 'OVER_REFUND')).toBe(true);
    expect(workbook!.SheetNames).toContain('超额重复退款');
  });

  it('rules defaults', () => {
    const rules = toRefundRules(createRuleStore().getDefaults('ECOM-REFUND-002'));
    expect(rules.maxProcessingDays).toBe(7);
    expect(rules.requireRestock).toBe(true);
  });
});
