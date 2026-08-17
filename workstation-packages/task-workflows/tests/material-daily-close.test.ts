/**
 * Migrated from packages/data-engine/tests/material-daily-close.test.ts.
 * Uses @aw/task-workflows only (no data-engine → task-workflows dependency).
 */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildTicketPackageBytes,
  exportWorkbook,
  materialDailyCloseFileName,
  runMaterialDailyCloseWorkflow,
  type RawWorkbookInput,
} from '../src/index.js';

function workbookFromRows(rows: unknown[][], sheetName = '日清'): RawWorkbookInput {
  const headers = (rows[0] ?? []).map((cell) => String(cell ?? ''));
  const body = rows.slice(1).map((row) => {
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      record[header] = (row as unknown[])[index];
    });
    return record;
  });
  return {
    fileName: 'factory-daily.xlsx',
    sheets: [
      {
        sheetName,
        headers,
        rows: body,
      },
    ],
  };
}

describe('material daily close (migrated from data-engine compat)', () => {
  it('computes local inventory math and builds real multi-sheet xlsx tickets', () => {
    const input = workbookFromRows([
      ['物料编码', '物料名称', '仓库', '生产线', '单位', '日期', '期初库存', '入库数量', '出库数量', '废料数量', '实盘数量'],
      ['M001', '螺丝M4', '原料仓', '一线', 'PCS', '2026-07-19', 100, 20, 30, 5, 80],
      ['M002', '垫片', '原料仓', '一线', 'PCS', '2026-07-19', 50, 0, 10, 0, 45],
      ['M003', '弹簧', '线边仓', '二线', 'PCS', '2026-07-19', 200, 0, 0, 0, 200],
    ]);

    const result = runMaterialDailyCloseWorkflow({ workbooks: [input] });
    expect(result.blocked).toBe(false);
    expect(result.balances.length).toBe(3);
    expect(result.summary.replenishCount).toBe(1);
    expect(result.summary.scrapTicketCount).toBe(1);
    expect(result.summary.varianceCount).toBe(2);
    expect(result.summary.totalReplenishQty).toBe(5);
    expect(result.summary.totalScrapQty).toBe(5);

    const m001 = result.balances.find((line) => line.materialCode === 'M001')!;
    expect(m001.closingQuantity ?? m001.theoreticalQuantity).toBe(85);
    expect(m001.varianceQuantity).toBe(-5);
    expect(m001.replenishQuantity).toBe(5);

    expect(result.replenishTickets[0]?.['建议补料数量']).toBe(5);
    expect(result.scrapTickets[0]?.['废料数量']).toBe(5);
    expect(result.varianceTickets).toHaveLength(2);

    const bytes = buildTicketPackageBytes(result);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(500);

    const parsed = XLSX.read(bytes, { type: 'array' });
    expect(parsed.SheetNames).toEqual([
      '日清概览',
      '明细台账',
      '计算追溯',
      '补料单',
      '报废单',
      '盘点差异单',
    ]);
    const replenishSheet = XLSX.utils.sheet_to_json<Record<string, unknown>>(parsed.Sheets['补料单']!);
    expect(replenishSheet).toHaveLength(1);
    expect(replenishSheet[0]?.['物料名称']).toBe('螺丝M4');

    expect(materialDailyCloseFileName(result.generatedAt)).toMatch(/^物料日清单据包_\d{8}\.xlsx$/);
  });

  it('blocks sheets missing required columns instead of inventing numbers', () => {
    const input = workbookFromRows([
      ['姓名', '数量'],
      ['张三', 1],
    ]);
    input.fileName = 'bad.xlsx';
    const result = runMaterialDailyCloseWorkflow({ workbooks: [input] });
    expect(result.blocked || result.clarifications.length > 0).toBe(true);
  });

  it('exportWorkbook writes empty-sheet placeholder', () => {
    const bytes = exportWorkbook([{ name: '空表', rows: [] }]);
    const parsed = XLSX.read(bytes, { type: 'array' });
    expect(parsed.SheetNames).toEqual(['空表']);
  });
});
