import * as XLSX from 'xlsx';

const QTY_HINT = /数量|产量|用量|差异|比例|时长|分钟|达成|缺口|损失/;

function autoColWidth(rows: Array<Record<string, unknown>>, headers: string[]) {
  return headers.map((header) => {
    let max = header.length;
    for (const row of rows) {
      const len = String(row[header] ?? '').length;
      if (len > max) max = len;
    }
    return { wch: Math.min(Math.max(max + 2, 8), 40) };
  });
}

/** 统一业务 Excel：中文表头、筛选、冻结、列宽；剔除内部 ID / Token / 模型名 */
export function writeBusinessWorkbook(
  rows: Array<Record<string, unknown>>,
  sheetName: string,
): Uint8Array {
  const workbook = XLSX.utils.book_new();
  if (!rows.length) {
    const empty = XLSX.utils.aoa_to_sheet([['（本日无记录）']]);
    XLSX.utils.book_append_sheet(workbook, empty, sheetName.slice(0, 31));
    return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as number[]);
  }

  const sanitized = rows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (/^(id|_id|dbId|model|token)/i.test(k)) continue;
      if (typeof v === 'string' && /sk-[a-zA-Z0-9]{10,}/.test(v)) continue;
      next[k] = v;
    }
    return next;
  });

  const headers = Object.keys(sanitized[0]!);
  const worksheet = XLSX.utils.json_to_sheet(sanitized, { header: headers });
  for (let r = 0; r < sanitized.length; r++) {
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c]!;
      const addr = XLSX.utils.encode_cell({ r: r + 1, c });
      const cell = worksheet[addr];
      if (!cell) continue;
      if (QTY_HINT.test(header) && typeof cell.v === 'number') {
        cell.t = 'n';
        cell.z = /比例|达成率/.test(header) ? '0.00%' : '#,##0.###';
      }
    }
  }
  worksheet['!cols'] = autoColWidth(sanitized, headers);
  worksheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: sanitized.length, c: headers.length - 1 },
    }),
  };
  (worksheet as { '!views'?: Array<Record<string, unknown>> })['!views'] = [
    { state: 'frozen', ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' },
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as number[]);
}

export function dayStamp(iso = new Date().toISOString()) {
  return iso.slice(0, 10).replace(/-/g, '');
}
