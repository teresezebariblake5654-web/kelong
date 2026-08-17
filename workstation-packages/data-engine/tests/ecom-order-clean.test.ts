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
  toOrderCleanRules,
  maskPhone,
  countDistinct,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

async function runOrder(options: {
  orders: unknown[][];
  sku?: unknown[][];
  rules?: Record<string, unknown>;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-ecom-ord-'));
  const orders = join(dir, 'orders.xlsx');
  writeSheet(orders, options.orders);
  const inputFiles: Array<{ role: string; path: string }> = [{ role: 'orders', path: orders }];
  if (options.sku) {
    const p = join(dir, 'sku.xlsx');
    writeSheet(p, options.sku);
    inputFiles.push({ role: 'sku_master', path: p });
  }
  const result = await createWorkflowRuntime().execute({
    workflowId: 'ECOM-ORDER-CLEAN-001',
    inputFiles,
    rules: options.rules,
    outputDir: join(dir, 'out'),
    runDate: '2026-07-15',
  });
  const workbook = result.outputFiles[0]
    ? XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' })
    : null;
  return { result, workbook };
}

describe('ECOM-ORDER-CLEAN-001', () => {
  it('normal case: distinct order count and decimal item totals', async () => {
    expect(moneyToFixed(moneyAdd('0.1', '0.2'))).toBe('0.30');
    expect(maskPhone('13800138000')).toBe('138****8000');
    const { result, workbook } = await runOrder({
      orders: [
        ['平台', '订单号', '行项目', '下单时间', 'SKU', '数量', '行金额', '订单金额', '运费', '优惠', '支付状态', '发货状态', '收货人', '手机', '地址'],
        ['淘宝', 'O1', 'L1', '2026-07-10', 'SKU1', 1, '0.1', '0.30', '0', '0', '已付款', '待发货', '张三', '13800138000', '上海市浦东新区xx路'],
        ['淘宝', 'O1', 'L2', '2026-07-10', 'SKU2', 1, '0.2', '0.30', '0', '0', '已付款', '待发货', '张三', '13800138000', '上海市浦东新区xx路'],
      ],
      sku: [
        ['SKU', '商品名称', '状态', '重量'],
        ['SKU1', '商品A', '上架', 1],
        ['SKU2', '商品B', '上架', 1],
      ],
    });
    expect(result.errorMessage).toBeUndefined();
    expect(result.status).toBe('COMPLETED');
    expect(result.metrics.orderCount).toBe(1);
    expect(result.metrics.orderLineCount).toBe(2);
    expect(result.metrics.cloudUpload).toBe(false);
    expect(result.outputFiles[0]).toMatch(/订单清洗结果_2026-07-15\.xlsx$/);
    expect(workbook!.SheetNames).toEqual(
      expect.arrayContaining(['可发货订单', '订单行明细', '金额异常', '地址异常', '运行说明']),
    );
    const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['订单行明细']!);
    expect(detail.every((r) => String(r.phoneMasked).includes('*'))).toBe(true);
    expect(result.aiSummaryPayload?.rawRows).toBe(false);
  });

  it('missing role fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-ecom-ord-miss-'));
    const result = await createWorkflowRuntime().execute({
      workflowId: 'ECOM-ORDER-CLEAN-001',
      inputFiles: [],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-15',
    });
    expect(result.status).toBe('FAILED');
  });

  it('duplicate + unpaid + amount mismatch → NEEDS_REVIEW', async () => {
    const { result, workbook } = await runOrder({
      orders: [
        ['平台', '订单号', '行项目', '下单时间', 'SKU', '数量', '行金额', '订单金额', '支付状态', '发货状态', '收货人', '手机', '地址'],
        ['抖音', 'D1', 'X1', '2026-07-10', 'S1', 1, 100, 100, '已付款', '待发货', '李四', '13900001111', '北京市朝阳区'],
        ['抖音', 'D1', 'X1', '2026-07-10', 'S1', 1, 100, 100, '已付款', '待发货', '李四', '13900001111', '北京市朝阳区'],
        ['抖音', 'D2', 'X2', '2026-07-11', 'S9', 1, 50, 80, '未付款', '待发货', '王五', '137', ''],
      ],
      sku: [
        ['SKU', '商品名称', '状态', '重量'],
        ['S1', 'A', '上架', 1],
      ],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.some((e) => e.code === 'DUPLICATE' || e.code === 'UNPAID' || e.code === 'AMOUNT_MISMATCH')).toBe(true);
    expect(workbook!.SheetNames).toContain('重复订单');
    expect(workbook!.SheetNames).toContain('未知SKU');
  });

  it('rules defaults and deterministic mask', () => {
    const defaults = createRuleStore().getDefaults('ECOM-ORDER-CLEAN-001');
    const rules = toOrderCleanRules(defaults);
    expect(rules.amountTolerance).toBe('0.01');
    expect(rules.phoneMasking).toBe(true);
    expect(countDistinct([{ orderNo: 'A' }, { orderNo: 'A' }, { orderNo: 'B' }], 'orderNo')).toBe(2);
  });

  it('fetch stays 0', async () => {
    let fetchCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return original(...args);
    }) as typeof fetch;
    try {
      await runOrder({
        orders: [
          ['订单号', '下单时间', 'SKU', '数量', '行金额', '订单金额', '支付状态', '发货状态', '收货人', '手机', '地址'],
          ['O9', '2026-07-10', 'S1', 1, 10, 10, '已付款', '待发货', '赵六', '13800138000', '杭州市西湖区'],
        ],
      });
      expect(fetchCount).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
