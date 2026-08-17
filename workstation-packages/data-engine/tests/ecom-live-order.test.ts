import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createRuleStore,
  createWorkflowRuntime,
  moneyToFixed,
  oversellQty,
  toLiveOrderRules,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

async function runLive(options: {
  orders: unknown[][];
  inventory?: unknown[][];
  plan?: unknown[][];
}) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-ecom-live-'));
  const orders = join(dir, 'orders.xlsx');
  writeSheet(orders, options.orders);
  const inputFiles: Array<{ role: string; path: string }> = [{ role: 'live_orders', path: orders }];
  if (options.inventory) {
    const p = join(dir, 'inv.xlsx');
    writeSheet(p, options.inventory);
    inputFiles.push({ role: 'inventory', path: p });
  }
  if (options.plan) {
    const p = join(dir, 'plan.xlsx');
    writeSheet(p, options.plan);
    inputFiles.push({ role: 'live_plan', path: p });
  }
  const result = await createWorkflowRuntime().execute({
    workflowId: 'ECOM-LIVE-ORDER-004',
    inputFiles,
    outputDir: join(dir, 'out'),
    runDate: '2026-07-15',
  });
  const workbook = result.outputFiles[0]
    ? XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' })
    : null;
  return { result, workbook };
}

describe('ECOM-LIVE-ORDER-004', () => {
  it('session match + distinct order count', async () => {
    expect(moneyToFixed(oversellQty(10, 7), 0)).toBe('3');
    const { result, workbook } = await runLive({
      orders: [
        ['平台', '场次ID', '订单号', '下单时间', 'SKU', '数量', '实付', '订单状态'],
        ['抖音', 'LS1', 'O1', '2026-07-10', 'S1', 1, '0.1', '已付款'],
        ['抖音', 'LS1', 'O1', '2026-07-10', 'S2', 1, '0.2', '已付款'],
      ],
      inventory: [
        ['SKU', '可售库存'],
        ['S1', 100],
        ['S2', 100],
      ],
      plan: [
        ['场次ID', '主播', '开始时间', '结束时间'],
        ['LS1', '主播A', '2026-07-10', '2026-07-10'],
      ],
    });
    expect(result.status).toBe('COMPLETED');
    expect(result.metrics.orderCount).toBe(1);
    expect(result.metrics.autoCancel).toBe(false);
    expect(workbook!.SheetNames).toEqual(
      expect.arrayContaining(['待发货订单', '直播场次汇总', '商品汇总', '超卖订单']),
    );
  });

  it('oversell flagged without auto cancel', async () => {
    const { result, workbook } = await runLive({
      orders: [
        ['平台', '场次ID', '订单号', '下单时间', 'SKU', '数量', '实付', '订单状态'],
        ['抖音', 'LS2', 'O9', '2026-07-10', 'S1', 5, 100, '已付款'],
      ],
      inventory: [
        ['SKU', '可售库存'],
        ['S1', 2],
      ],
      plan: [
        ['场次ID', '主播', '开始时间', '结束时间'],
        ['LS2', '主播B', '2026-07-10', '2026-07-10'],
      ],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.some((e) => e.code === 'OVERSELL')).toBe(true);
    expect(result.metrics.autoCancel).toBe(false);
    expect(workbook!.SheetNames).toContain('超卖订单');
  });

  it('missing live_orders fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-ecom-live-miss-'));
    const result = await createWorkflowRuntime().execute({
      workflowId: 'ECOM-LIVE-ORDER-004',
      inputFiles: [],
      outputDir: join(dir, 'out'),
    });
    expect(result.status).toBe('FAILED');
  });

  it('rules defaults', () => {
    const rules = toLiveOrderRules(createRuleStore().getDefaults('ECOM-LIVE-ORDER-004'));
    expect(rules.sessionMatchRule).toBe('SESSION_ID_FIRST');
    expect(rules.oversellPolicy).toBe('FLAG_ONLY');
  });
});
