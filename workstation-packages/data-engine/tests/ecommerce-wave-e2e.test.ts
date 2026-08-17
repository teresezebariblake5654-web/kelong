import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createWorkflowRuntime } from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

describe('Ecommerce wave e2e — all 5 workflows', () => {
  it('executes all ecommerce workflows, re-reads sheets, fetch=0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-ecom-wave-'));
    const out = join(dir, 'out');
    const runtime = createWorkflowRuntime();
    let fetchCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return original(...args);
    }) as typeof fetch;

    try {
      const orders = join(dir, 'orders.xlsx');
      writeSheet(orders, [
        ['平台', '订单号', '行项目', '下单时间', 'SKU', '数量', '行金额', '订单金额', '支付状态', '发货状态', '收货人', '手机', '地址'],
        ['淘宝', 'O1', 'L1', '2026-07-10', 'S1', 1, 100, 100, '已付款', '待发货', '张三', '13800138000', '上海市浦东新区'],
      ]);
      const orderResult = await runtime.execute({
        workflowId: 'ECOM-ORDER-CLEAN-001',
        inputFiles: [{ role: 'orders', path: orders }],
        outputDir: out,
        runDate: '2026-07-15',
      });

      const paid = join(dir, 'paid.xlsx');
      const refunds = join(dir, 'refunds.xlsx');
      writeSheet(paid, [
        ['订单号', '实付', '支付方式', '发货状态'],
        ['O1', 100, '支付宝', '已发货'],
      ]);
      writeSheet(refunds, [
        ['退款单号', '订单号', '退款金额', '退款时间', '退款状态', '退款原因'],
        ['R1', 'O1', 10, '2026-07-12', '完成', '仅退款'],
      ]);
      const refundResult = await runtime.execute({
        workflowId: 'ECOM-REFUND-002',
        inputFiles: [
          { role: 'orders', path: paid },
          { role: 'refunds', path: refunds },
        ],
        outputDir: out,
        runDate: '2026-07-15',
      });

      const products = join(dir, 'products.xlsx');
      writeSheet(products, [
        ['商品ID', 'SKU', '商品名称', '售价', '成本', '状态'],
        ['P1', 'S1', '商品A', 100, 40, '上架'],
      ]);
      const productResult = await runtime.execute({
        workflowId: 'ECOM-PRODUCT-DATA-003',
        inputFiles: [{ role: 'products', path: products }],
        outputDir: out,
        runDate: '2026-07-15',
      });

      const live = join(dir, 'live.xlsx');
      writeSheet(live, [
        ['平台', '场次ID', '订单号', '下单时间', 'SKU', '数量', '实付', '订单状态'],
        ['抖音', 'LS1', 'L1', '2026-07-10', 'S1', 1, 50, '已付款'],
      ]);
      const liveResult = await runtime.execute({
        workflowId: 'ECOM-LIVE-ORDER-004',
        inputFiles: [{ role: 'live_orders', path: live }],
        outputDir: out,
        runDate: '2026-07-15',
      });

      const sales = join(dir, 'sales.xlsx');
      writeSheet(sales, [
        ['订单号', '日期', '平台', '店铺', 'SKU', '数量', '毛销售', '折扣', '运费', '税'],
        ['O1', '2026-07-01', '淘宝', '旗舰店', 'S1', 1, 100, 0, 0, 0],
      ]);
      const salesResult = await runtime.execute({
        workflowId: 'ECOM-SALES-SUMMARY-005',
        inputFiles: [{ role: 'sales_orders', path: sales }],
        outputDir: out,
        runDate: '2026-07-15',
      });

      for (const result of [orderResult, refundResult, productResult, liveResult, salesResult]) {
        expect(result.errorMessage).toBeUndefined();
        expect(['COMPLETED', 'NEEDS_REVIEW']).toContain(result.status);
        expect(result.outputFiles[0]).toBeTruthy();
        expect(result.metrics.cloudUpload).toBe(false);
        const wb = XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' });
        expect(wb.SheetNames.length).toBeGreaterThan(3);
        expect(wb.SheetNames).toContain('运行说明');
      }

      expect(orderResult.outputFiles[0]).toMatch(/订单清洗结果_/);
      expect(refundResult.outputFiles[0]).toMatch(/退款异常核对_/);
      expect(productResult.outputFiles[0]).toMatch(/商品数据诊断_/);
      expect(liveResult.outputFiles[0]).toMatch(/直播订单处理_/);
      expect(salesResult.outputFiles[0]).toMatch(/电商销售汇总_/);
      expect(salesResult.metrics.orderCount).toBe(1);
      expect(fetchCount).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
