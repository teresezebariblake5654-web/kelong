import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { dataEngine } from '../src/index.js';

function workbookBuffer(rows: unknown[][], sheetName = 'Sheet1') {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('LocalDataEngine', () => {
  it('parses workbook, detects headers and infers types', () => {
    const buffer = workbookBuffer([
      ['部门', '人数', '日期', ''],
      ['人事', 12, '2026-01-01', null],
      ['生产', 8, '2026-01-02', null],
      [null, null, null, null],
      ['人事', 12, '2026-01-01', null],
    ]);

    const workbook = dataEngine.parseFile(buffer, 'demo.xlsx');
    expect(workbook.sheets).toHaveLength(1);
    const sheet = workbook.sheets[0]!;
    expect(sheet.headers[0]).toBe('部门');
    expect(sheet.rows).toHaveLength(3);

    const cleaned = dataEngine.cleanData(sheet);
    expect(cleaned.duplicatesRemoved).toBe(1);
    expect(cleaned.sheet.rows).toHaveLength(2);

    const profile = cleaned.sheet.columnProfiles.find((item) => item.name === '人数');
    expect(profile?.type).toBe('number');

    const aggregates = dataEngine.aggregateData(cleaned.sheet.rows, [
      { column: '人数', op: 'sum' },
      { column: '人数', op: 'avg' },
      { column: '人数', op: 'min' },
      { column: '人数', op: 'max' },
      { column: '人数', op: 'count' },
    ]);
    expect(aggregates.sum_人数).toBe(20);
    expect(aggregates.count_人数).toBe(2);

    const structured = dataEngine.buildStructuredResult({
      fileName: 'demo.xlsx',
      sheet: cleaned.sheet,
      groupBy: ['部门'],
      quality: {
        emptyRowRemoved: cleaned.emptyRemoved,
        duplicateRowRemoved: cleaned.duplicatesRemoved,
      },
    });
    expect(structured.meta.rowCount).toBe(2);
    expect(structured.groups?.length).toBe(2);
  });

  it('filters and sorts rows', () => {
    const rows = [
      { name: 'A', score: 90 },
      { name: 'B', score: 70 },
      { name: 'C', score: 80 },
    ];
    const filtered = dataEngine.filterData(rows, [
      { column: 'score', operator: 'gte', value: 80 },
    ]);
    expect(filtered).toHaveLength(2);
    const sorted = dataEngine.sortData(filtered, [{ column: 'score', direction: 'desc' }]);
    expect(sorted[0]?.name).toBe('A');
  });

  it('exports csv and xlsx', () => {
    const rows = [{ department: 'HR', count: 3 }];
    const csv = dataEngine.exportResult(rows, 'csv');
    expect(String(csv)).toContain('department');
    const xlsx = dataEngine.exportResult(rows, 'xlsx');
    expect(xlsx).toBeInstanceOf(Uint8Array);
  });
});
