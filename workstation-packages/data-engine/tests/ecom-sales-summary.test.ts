import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  averageOrderValue,
  createRuleStore,
  createWorkflowRuntime,
  moneyAdd,
  moneyToFixed,
  toDecimal,
  toSalesSummaryRules,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

async function runSales(options: {
  sales: unknown[][];
  refunds?: unknown[][];
  cost?: unknown[][];
}) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-ecom-sales-'));
  const sales = join(dir, 'sales.xlsx');
  writeSheet(sales, options.sales);
  const inputFiles: Array<{ role: string; path: string }> = [{ role: 'sales_orders', path: sales }];
  if (options.refunds) {
    const p = join(dir, 'refunds.xlsx');
    writeSheet(p, options.refunds);
    inputFiles.push({ role: 'refunds', path: p });
  }
  if (options.cost) {
    const p = join(dir, 'cost.xlsx');
    writeSheet(p, options.cost);
    inputFiles.push({ role: 'product_cost', path: p });
  }
  const result = await createWorkflowRuntime().execute({
    workflowId: 'ECOM-SALES-SUMMARY-005',
    inputFiles,
    outputDir: join(dir, 'out'),
    runDate: '2026-07-15',
  });
  const workbook = result.outputFiles[0]
    ? XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' })
    : null;
  return { result, workbook };
}

describe('ECOM-SALES-SUMMARY-005', () => {
  it('net sales control total and distinct orders', async () => {
    expect(moneyToFixed(moneyAdd('0.1', '0.2'))).toBe('0.30');
    expect(averageOrderValue(toDecimal('90'), 2)).toBe('45.00');

    const { result, workbook } = await runSales({
      sales: [
        ['订单号', '日期', '平台', '店铺', 'SKU', '数量', '毛销售', '折扣', '运费', '税'],
        ['O1', '2026-07-01', '淘宝', '旗舰店', 'S1', 1, '0.1', '0', 0, 0],
        ['O1', '2026-07-01', '淘宝', '旗舰店', 'S2', 1, '0.2', '0', 0, 0],
        ['O2', '2026-07-02', '京东', '专卖店', 'S1', 1, 100, 10, 0, 0],
      ],
      refunds: [
        ['订单号', '退款金额', '退款日期'],
        ['O2', 20, '2026-07-03'],
      ],
      cost: [
        ['SKU', '单位成本'],
        ['S1', 30],
        ['S2', 10],
      ],
    });
    expect(result.errorMessage).toBeUndefined();
    expect(result.metrics.orderCount).toBe(2);
    expect(result.metrics.controlBalanced).toBe(true);
    expect(result.metrics.cloudUpload).toBe(false);
    expect(result.outputFiles[0]).toMatch(/电商销售汇总_/);
    expect(workbook!.SheetNames).toEqual(
      expect.arrayContaining(['销售总览', '平台汇总', '商品排行', '渠道汇总', '趋势', '运行说明']),
    );
    const overview = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['销售总览']!);
    expect(overview[0]!.orderCount).toBe(2);
    expect(overview[0]!.controlBalanced).toBe(true);
  });

  it('missing sales_orders fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-ecom-sales-miss-'));
    const result = await createWorkflowRuntime().execute({
      workflowId: 'ECOM-SALES-SUMMARY-005',
      inputFiles: [],
      outputDir: join(dir, 'out'),
    });
    expect(result.status).toBe('FAILED');
  });

  it('duplicate lines → NEEDS_REVIEW', async () => {
    const { result } = await runSales({
      sales: [
        ['订单号', '行项目', '日期', '平台', '店铺', 'SKU', '数量', '毛销售', '折扣', '运费', '税'],
        ['O1', 'L1', '2026-07-01', '淘宝', '店', 'S1', 1, 10, 0, 0, 0],
        // same platform+orderNo+lineItemId with different payload (engine drops exact row dupes)
        ['O1', 'L1', '2026-07-01', '淘宝', '店', 'S2', 2, 20, 0, 1, 0],
      ],
    });
    expect(result.metrics.orderLineCount).toBe(2);
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.some((e) => e.code === 'DUPLICATE')).toBe(true);
  });

  it('rules defaults', () => {
    const rules = toSalesSummaryRules(createRuleStore().getDefaults('ECOM-SALES-SUMMARY-005'));
    expect(rules.orderCountRule).toBe('DISTINCT_ORDER_NO');
    expect(rules.period).toBe('MONTH');
  });
});
