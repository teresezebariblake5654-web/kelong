import * as XLSX from 'xlsx';

export type LocalTableExportResult = {
  fileName: string;
  saved: boolean;
};

function parseMarkdownTables(content: string): string[][][] {
  const lines = content.split(/\r?\n/);
  const tables: string[][][] = [];
  let current: string[][] = [];

  const flush = () => {
    if (current.length >= 2) tables.push(current);
    current = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('|')) {
      flush();
      continue;
    }
    // Skip markdown separator rows like |---|---|
    if (/^\|?\s*:?-{3,}/.test(line.replace(/\s/g, ''))) {
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length) current.push(cells);
  }
  flush();
  return tables;
}

function triggerDownload(bytes: Uint8Array, fileName: string): void {
  // Copy into a fresh ArrayBuffer-backed view so BlobPart typing accepts it.
  const payload = new Uint8Array(bytes.byteLength);
  payload.set(bytes);
  const blob = new Blob([payload], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Save assistant reply tables as .xlsx on the client (no backend required).
 * Prefer markdown tables; fall back to line-split sheet when none found.
 */
export async function exportMessageAsTableLocally(
  content: string,
  preferredName = 'AI对话表格.xlsx',
): Promise<LocalTableExportResult> {
  const tables = parseMarkdownTables(content);
  const workbook = XLSX.utils.book_new();

  if (tables.length) {
    tables.forEach((rows, index) => {
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(workbook, sheet, `结果${index + 1}`.slice(0, 31));
    });
  } else {
    const rows = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => [line]);
    const sheet = XLSX.utils.aoa_to_sheet(rows.length ? rows : [['（无表格内容）']]);
    XLSX.utils.book_append_sheet(workbook, sheet, '对话内容');
  }

  const raw = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const bytes = new Uint8Array(raw);
  const fileName = preferredName.endsWith('.xlsx') ? preferredName : `${preferredName}.xlsx`;
  triggerDownload(bytes, fileName);
  return { fileName, saved: true };
}
