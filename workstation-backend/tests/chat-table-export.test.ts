import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  createWorkbookBuffer,
  extractMarkdownTables,
} from '../src/services/chatTableExport.service';

describe('extractMarkdownTables', () => {
  it('extracts only markdown tables and ignores prose outside', () => {
    const content = [
      '结论：本月整体正常，建议关注华南。',
      '',
      '| 地区 | 销售额 |',
      '| --- | --- |',
      '| 华东 | 1,200 |',
      '| 华南 | 980 |',
      '',
      '下一步：人工复核华南异常。',
      '',
      '- 不要把这段列表写进 Excel',
      '',
      '| 项目 | 金额 |',
      '|---|---|',
      '| 房租 | 1000 |',
    ].join('\n');

    const tables = extractMarkdownTables(content);
    expect(tables).toHaveLength(2);
    expect(tables[0]).toEqual({
      headers: ['地区', '销售额'],
      rows: [
        ['华东', 1200],
        ['华南', 980],
      ],
    });
    expect(tables[1]).toEqual({
      headers: ['项目', '金额'],
      rows: [['房租', 1000]],
    });
  });

  it('returns empty when there is no markdown table', () => {
    expect(extractMarkdownTables('只有文字，没有表格')).toEqual([]);
  });
});

describe('createWorkbookBuffer', () => {
  it('creates a readable xlsx workbook with normalized rows', () => {
    const buffer = createWorkbookBuffer({
      fileName: '销售汇总',
      sheets: [
        {
          name: '销售/汇总',
          headers: ['地区', '销售额', '备注'],
          rows: [
            ['华东', 1200],
            ['华南', 980, '待复核', 'ignored'],
          ],
        },
      ],
    });

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['销售_汇总']);
    expect(
      XLSX.utils.sheet_to_json(workbook.Sheets['销售_汇总']!, {
        header: 1,
        defval: null,
      }),
    ).toEqual([
      ['地区', '销售额', '备注'],
      ['华东', 1200, null],
      ['华南', 980, '待复核'],
    ]);
  });

  it('deduplicates worksheet names', () => {
    const buffer = createWorkbookBuffer({
      fileName: '结果',
      sheets: [
        { name: '明细', headers: ['值'], rows: [[1]] },
        { name: '明细', headers: ['值'], rows: [[2]] },
      ],
    });

    expect(XLSX.read(buffer, { type: 'buffer' }).SheetNames).toEqual(['明细', '明细_2']);
  });
});
