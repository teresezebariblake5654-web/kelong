import fs from 'fs';
import * as XLSX from 'xlsx';
import { AppError } from '../utils/errors';

export interface ParsedSheet {
  name: string;
  headers: string[];
  rowCount: number;
  sampleRows: Record<string, unknown>[];
}

export interface ParsedPreview {
  sheets: ParsedSheet[];
}

const PARSEABLE_EXTENSIONS = new Set(['xlsx', 'xls', 'csv']);
const SAMPLE_ROW_LIMIT = 20;

function isEmptyRow(row: unknown[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || cell === '');
}

function parseSheet(sheet: XLSX.WorkSheet | undefined, name: string): ParsedSheet {
  if (!sheet || !sheet['!ref']) {
    return {
      name,
      headers: [],
      rowCount: 0,
      sampleRows: [],
    };
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });

  if (matrix.length === 0) {
    return {
      name,
      headers: [],
      rowCount: 0,
      sampleRows: [],
    };
  }

  const headers = (matrix[0] ?? []).map((cell) => String(cell ?? '').trim());
  const dataRows = matrix.slice(1).filter((row) => !isEmptyRow(row as unknown[]));
  const rowCount = dataRows.length;

  const sampleRows = dataRows.slice(0, SAMPLE_ROW_LIMIT).map((row) => {
    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      const key = header || `column_${index + 1}`;
      record[key] = (row as unknown[])[index] ?? null;
    });
    return record;
  });

  return {
    name,
    headers,
    rowCount,
    sampleRows,
  };
}

export const parserService = {
  parseExcelFile(filePath: string, extension: string): ParsedPreview {
    if (!PARSEABLE_EXTENSIONS.has(extension.toLowerCase())) {
      throw new AppError(400, '当前文件类型不支持 Excel 解析', 'UNSUPPORTED_FILE_TYPE');
    }

    if (!fs.existsSync(filePath)) {
      throw new AppError(404, '文件不存在于存储路径', 'FILE_NOT_FOUND');
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.readFile(filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      throw new AppError(422, `Excel 文件格式错误: ${message}`, 'PARSE_ERROR');
    }

    if (!workbook.SheetNames.length) {
      return { sheets: [] };
    }

    const sheets = workbook.SheetNames.map((name) =>
      parseSheet(workbook.Sheets[name], name),
    );

    return { sheets };
  },
};
