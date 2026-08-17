import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createRuleStore,
  createWorkflowRuntime,
  daysOfInventory,
  grossMargin,
  moneyToFixed,
  toDecimal,
  toProductDataRules,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

async function runProduct(options: {
  products: unknown[][];
  inventory?: unknown[][];
  sales?: unknown[][];
}) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-ecom-prd-'));
  const products = join(dir, 'products.xlsx');
  writeSheet(products, options.products);
  const inputFiles: Array<{ role: string; path: string }> = [{ role: 'products', path: products }];
  if (options.inventory) {
    const p = join(dir, 'inv.xlsx');
    writeSheet(p, options.inventory);
    inputFiles.push({ role: 'inventory', path: p });
  }
  if (options.sales) {
    const p = join(dir, 'sales.xlsx');
    writeSheet(p, options.sales);
    inputFiles.push({ role: 'sales', path: p });
  }
  const result = await createWorkflowRuntime().execute({
    workflowId: 'ECOM-PRODUCT-DATA-003',
    inputFiles,
    outputDir: join(dir, 'out'),
    runDate: '2026-07-20',
  });
  const workbook = result.outputFiles[0]
    ? XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' })
    : null;
  return { result, workbook };
}

describe('ECOM-PRODUCT-DATA-003', () => {
  it('computes margin and skips DOI without sales history', async () => {
    const m = grossMargin('100', '60');
    expect(m.ok && moneyToFixed(m.margin)).toBe('40.00');
    expect(daysOfInventory(toDecimal(100), null)).toBeNull();

    const { result, workbook } = await runProduct({
      products: [
        ['商品ID', 'SKU', '商品名称', '售价', '成本', '状态'],
        ['P1', 'SKU1', '商品A', 100, 60, '上架'],
      ],
      inventory: [
        ['SKU', '可用库存', '预留'],
        ['SKU1', 50, 10],
      ],
    });
    expect(result.status).toBe('COMPLETED');
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['商品总表']!);
    expect(rows[0]!.onHandQty).toBe('40');
    expect(rows[0]!.grossMargin).toBe('40.00');
    expect(rows[0]!.daysOfInventory).toBe('N/A_NO_SALES_HISTORY');
    expect(result.metrics.autoUpdateListing).toBe(false);
  });

  it('duplicate sku and negative margin → NEEDS_REVIEW', async () => {
    const { result, workbook } = await runProduct({
      products: [
        ['商品ID', 'SKU', '商品名称', '售价', '成本', '状态'],
        ['P1', 'SKU1', '商品A', 50, 80, '上架'],
        ['P2', 'SKU1', '商品A2', 50, 80, '上架'],
      ],
      inventory: [
        ['SKU', '可用库存'],
        ['SKU1', 0],
      ],
      sales: [
        ['日期', 'SKU', '销量', '销售额'],
        ['2026-06-01', 'SKU1', 1, 50],
      ],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(workbook!.SheetNames).toEqual(
      expect.arrayContaining(['重复SKU', '毛利异常', '缺货风险', '低动销']),
    );
  });

  it('missing products fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-ecom-prd-miss-'));
    const result = await createWorkflowRuntime().execute({
      workflowId: 'ECOM-PRODUCT-DATA-003',
      inputFiles: [],
      outputDir: join(dir, 'out'),
    });
    expect(result.status).toBe('FAILED');
  });

  it('rules defaults', () => {
    const rules = toProductDataRules(createRuleStore().getDefaults('ECOM-PRODUCT-DATA-003'));
    expect(rules.marginThreshold).toBe(0.1);
    expect(rules.daysOfInventoryThreshold).toBe(90);
  });
});
