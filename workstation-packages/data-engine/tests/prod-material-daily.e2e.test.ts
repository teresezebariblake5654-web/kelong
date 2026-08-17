import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { executeWorkflow } from '../src/index.js';

/**
 * End-to-end sample for PROD-MATERIAL-DAILY-001.
 * Raw workbooks stay on local disk; runtime never posts them to a backend URL.
 */
describe('PROD-MATERIAL-DAILY-001 e2e sample', () => {
  it('reads local Excel roles, writes result workbook, keeps data local', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-md-e2e-'));
    const openingPath = join(dir, '期初库存.xlsx');
    const movementPath = join(dir, '出入库.xlsx');
    const countPath = join(dir, '实盘.xlsx');
    const outputDir = join(dir, 'output');

    const writeAoa = (path: string, rows: unknown[][]) => {
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '数据');
      writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    };

    writeAoa(openingPath, [
      ['料号', '品名', '仓库名称', '期初库存', '计量单位'],
      ['P-100', '钢板', '一号仓', 200, 'KG'],
      ['P-200', '铝板', '一号仓', 80, 'KG'],
    ]);
    writeAoa(movementPath, [
      ['业务日期', '料号', '出入库类型', '数量', '仓库名称', '计量单位'],
      ['2026-07-21', 'P-100', '采购入库', 50, '一号仓', 'KG'],
      ['2026-07-21', 'P-100', '生产领用', 70, '一号仓', 'KG'],
      ['2026-07-21', 'P-100', '退料', 10, '一号仓', 'KG'],
      ['2026-07-21', 'P-200', '领料', 20, '一号仓', 'KG'],
    ]);
    writeAoa(countPath, [
      ['料号', '仓库名称', '盘点数量', '计量单位'],
      ['P-100', '一号仓', 185, 'KG'],
      ['P-200', '一号仓', 60, 'KG'],
    ]);

    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      throw new Error('network should not be used in local workflow execution');
    }) as typeof fetch;

    try {
      const result = await executeWorkflow({
        workflowId: 'PROD-MATERIAL-DAILY-001',
        inputFiles: [
          { role: 'opening_stock', path: openingPath },
          { role: 'movements', path: movementPath },
          { role: 'physical_count', path: countPath },
        ],
        companyRules: {
          'materialDaily.toleranceQty': 5,
          'materialDaily.toleranceRate': 0.1,
          'materialDaily.negativeStockBlocked': true,
        },
        outputDir,
        runDate: '2026-07-22',
      });

      expect(fetchCalls).toEqual([]);
      expect(result.errorMessage).toBeUndefined();
      expect(result.outputFiles[0]).toBe(join(outputDir, '物料日清结果_2026-07-22.xlsx'));
      expect(existsSync(result.outputFiles[0]!)).toBe(true);
      expect(result.metrics.uploadedRawWorkbook).toBe(false);
      expect(result.aiSummaryPayload).toMatchObject({ rawRows: false });

      const payloadText = JSON.stringify(result.aiSummaryPayload);
      expect(payloadText).not.toMatch(/钢板|铝板|P-100|P-200/);
      expect(payloadText).not.toContain(openingPath);

      const workbook = XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' });
      const daily = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['日清总表']!);
      const p100 = daily.find((row) => row.materialCode === 'P-100');
      // 200 + 50 - 70 + 10 = 190
      expect(Number(p100!.theoreticalClosingQty)).toBe(190);
      expect(Number(p100!.varianceQty)).toBe(-5);
      expect(p100!.sourceFile).toContain('.xlsx');
      expect(String(p100!.inputSha256).length).toBeGreaterThan(20);

      const notes = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['运行说明']!);
      const cloudUpload = notes.find((row) => row.key === 'cloudUpload');
      expect(cloudUpload?.value).toBe(false);
      const localOnly = notes.find((row) => row.key === 'localOnly');
      expect(localOnly?.value).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
