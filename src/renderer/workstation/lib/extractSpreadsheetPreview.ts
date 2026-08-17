import * as XLSX from 'xlsx';

/** Soft caps — stay within typical chat model context while reading real tables. */
const MAX_FILES = 5;
const MAX_SHEETS = 12;
const MAX_ROWS = 3000;
const MAX_COLS = 60;
const MAX_CHARS = 100_000;

export type SpreadsheetExtractResult = {
  /** Text fed into the model prompt */
  text: string;
  /** True when rows/cols/chars were cut for context size */
  truncated: boolean;
  fileCount: number;
  totalRows: number;
  /** Short Chinese notice for UI toast / system line */
  notice: string;
};

function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/**
 * Read Excel/CSV into plain text for chat. Prefers full sheets; only truncates
 * when hitting hard size caps, and always explains what was cut.
 */
export async function extractSpreadsheetPreview(files: File[]): Promise<string> {
  const result = await extractSpreadsheetForChat(files);
  return result.text;
}

export async function extractSpreadsheetForChat(files: File[]): Promise<SpreadsheetExtractResult> {
  const excelFiles = files.filter((file) => /\.(xlsx|xls|csv)$/i.test(file.name));
  if (!excelFiles.length) {
    return {
      text: '',
      truncated: false,
      fileCount: 0,
      totalRows: 0,
      notice: '',
    };
  }

  const blocks: string[] = [];
  let truncated = false;
  let totalRows = 0;
  const truncateNotes: string[] = [];

  const selected = excelFiles.slice(0, MAX_FILES);
  if (excelFiles.length > MAX_FILES) {
    truncated = true;
    truncateNotes.push(`仅读取前 ${MAX_FILES} 个文件（共 ${excelFiles.length} 个）`);
  }

  for (const file of selected) {
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheetNames = workbook.SheetNames.slice(0, MAX_SHEETS);
      if (workbook.SheetNames.length > MAX_SHEETS) {
        truncated = true;
        truncateNotes.push(
          `${file.name} 仅读取前 ${MAX_SHEETS} 个工作表（共 ${workbook.SheetNames.length} 个）`,
        );
      }

      const sheetBlocks: string[] = [`【完整表格】文件：${file.name}`];

      for (const name of sheetNames) {
        const sheet = workbook.Sheets[name];
        if (!sheet) continue;
        const rows = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null)[]>(sheet, {
          header: 1,
          defval: '',
          raw: false,
        }) as unknown[][];
        const nonEmpty = rows.filter((row) =>
          Array.isArray(row) ? row.some((cell) => cellText(cell) !== '') : false,
        );
        totalRows += nonEmpty.length;

        let usedRows = nonEmpty;
        if (nonEmpty.length > MAX_ROWS) {
          truncated = true;
          usedRows = nonEmpty.slice(0, MAX_ROWS);
          truncateNotes.push(
            `${file.name}「${name}」共 ${nonEmpty.length} 行，已读前 ${MAX_ROWS} 行`,
          );
        }

        const maxColsInSheet = usedRows.reduce(
          (max, row) => Math.max(max, Array.isArray(row) ? row.length : 0),
          0,
        );
        const colLimit = Math.min(MAX_COLS, maxColsInSheet || MAX_COLS);
        if (maxColsInSheet > MAX_COLS) {
          truncated = true;
          truncateNotes.push(
            `${file.name}「${name}」共 ${maxColsInSheet} 列，已读前 ${MAX_COLS} 列`,
          );
        }

        const lines = usedRows.map((row, index) => {
          const cells = (row as unknown[]).slice(0, colLimit).map(cellText);
          return `R${index + 1}: ${cells.join(' | ')}`;
        });

        sheetBlocks.push(
          `工作表「${name}」共 ${nonEmpty.length} 行 × ${maxColsInSheet} 列（本次读入 ${usedRows.length} 行 × ${colLimit} 列）：`,
          ...lines,
        );
      }

      blocks.push(sheetBlocks.join('\n'));
    } catch {
      truncated = true;
      blocks.push(`文件：${file.name}（解析失败，无法读取单元格）`);
      truncateNotes.push(`${file.name} 解析失败`);
    }
  }

  let text = blocks.join('\n\n');
  if (text.length > MAX_CHARS) {
    truncated = true;
    truncateNotes.push(`内容超过 ${MAX_CHARS} 字符上限，已截断尾部`);
    text = `${text.slice(0, MAX_CHARS)}\n…(后续行已截断)`;
  }

  if (truncated) {
    const header =
      '【注意】当前对话已尽量读取表格；因体积限制未能完整载入全部明细。' +
      (truncateNotes.length ? ` 详情：${truncateNotes.join('；')}。` : '') +
      '请缩小文件、拆表后重试，或只保留需要分析的列/行。\n\n';
    text = header + text;
  } else if (text) {
    text =
      '【表格已完整读入聊天】请基于下列全部单元格作答，可直接生成 Markdown 表格结果；勿编造未出现的数字。\n\n' +
      text;
  }

  return {
    text,
    truncated,
    fileCount: selected.length,
    totalRows,
    notice: truncated
      ? `表格过大，聊天未能载入全部明细（已读约 ${totalRows} 行相关数据）。${truncateNotes[0] ?? ''}`
      : selected.length
        ? `已完整读入 ${selected.length} 个表格（约 ${totalRows} 行），可在对话中直接分析并出表。`
        : '',
  };
}
