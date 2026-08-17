import * as XLSX from 'xlsx';
import type {
  AggregateOp,
  AggregateSpec,
  AnomalyMark,
  CleanOptions,
  ColumnProfile,
  ColumnType,
  DataEngine,
  DataRow,
  FilterRule,
  SheetData,
  SortRule,
  StructuredResult,
  TemplateExecutionResult,
  WorkbookData,
} from './types.js';
import { executeTaskTemplate } from './templateExecutor.js';

function extensionOf(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : '';
}

function isEmptyCell(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

function isEmptyRow(row: unknown[]): boolean {
  return row.every((cell) => isEmptyCell(cell));
}

export function normalizeColumnName(name: string, index: number): string {
  const cleaned = String(name || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w\u4e00-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || `column_${index + 1}`;
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', '是', '1'].includes(text)) return true;
  if (['false', 'no', 'n', '否', '0'].includes(text)) return false;
  return null;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).trim().replace(/,/g, '');
  if (!text || /[^\d.+-]/.test(text.replace(/^\+/, ''))) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  // Numeric Excel serials are already converted when reading with cellDates:true.
  // Do not treat arbitrary numbers (e.g. 工时=8) as dates during type inference.
  if (typeof value === 'number') return null;
  const text = String(value).trim();
  if (!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(text) && !/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(text)) {
    return null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function inferTypeFromValues(values: unknown[]): ColumnType {
  const nonEmpty = values.filter((value) => !isEmptyCell(value));
  if (nonEmpty.length === 0) return 'empty';
  const votes = { number: 0, date: 0, boolean: 0, string: 0 };
  for (const value of nonEmpty) {
    if (value instanceof Date) votes.date += 1;
    else if (parseNumber(value) !== null) votes.number += 1;
    else if (parseBoolean(value) !== null) votes.boolean += 1;
    else if (parseDate(value) !== null) votes.date += 1;
    else votes.string += 1;
  }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (!top || top[1] === 0) return 'empty';
  if (second && second[1] > 0 && second[1] >= top[1] * 0.35) return 'mixed';
  return top[0] as ColumnType;
}

function compareValues(a: unknown, b: unknown): number {
  if (isEmptyCell(a) && isEmptyCell(b)) return 0;
  if (isEmptyCell(a)) return 1;
  if (isEmptyCell(b)) return -1;
  const na = parseNumber(a);
  const nb = parseNumber(b);
  if (na !== null && nb !== null) return na - nb;
  return String(a).localeCompare(String(b), 'zh-CN', { numeric: true });
}

function rowKey(row: DataRow, headers: string[]): string {
  return headers.map((header) => JSON.stringify(row[header] ?? null)).join('|');
}

function aggregateValue(values: unknown[], op: AggregateOp): number | null {
  const nums = values
    .map((value) => parseNumber(value))
    .filter((value): value is number => value !== null);
  if (op === 'count') return values.filter((value) => !isEmptyCell(value)).length;
  if (nums.length === 0) return null;
  if (op === 'sum') return nums.reduce((sum, n) => sum + n, 0);
  if (op === 'avg') return nums.reduce((sum, n) => sum + n, 0) / nums.length;
  if (op === 'min') return Math.min(...nums);
  if (op === 'max') return Math.max(...nums);
  return null;
}

export class LocalDataEngine implements DataEngine {
  parseFile(input: ArrayBuffer | Uint8Array | Buffer, fileName: string): WorkbookData {
    const extension = extensionOf(fileName);
    if (!['xlsx', 'xls', 'csv'].includes(extension)) {
      throw new Error(`不支持的文件类型: ${extension || 'unknown'}`);
    }

    const workbook = XLSX.read(input, {
      type: 'array',
      cellDates: true,
      raw: false,
    });

    const sheets = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: null,
        blankrows: false,
      });
      const headers = this.detectHeaders(matrix);
      const dataRows = matrix.slice(1).filter((row) => !isEmptyRow(row as unknown[]));
      const rows: DataRow[] = dataRows.map((row) => {
        const record: DataRow = {};
        headers.forEach((header, index) => {
          record[header] = (row as unknown[])[index] ?? null;
        });
        return record;
      });
      return {
        name,
        headers,
        rows,
        columnProfiles: this.inferColumnTypes(rows, headers),
      } satisfies SheetData;
    });

    return { fileName, extension, sheets };
  }

  detectHeaders(matrix: unknown[][]): string[] {
    if (!matrix.length) return [];
    const first = (matrix[0] || []).map((cell) => String(cell ?? '').trim());
    const used = new Map<string, number>();
    return first.map((raw, index) => {
      const base = normalizeColumnName(raw, index);
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      return count === 0 ? base : `${base}_${count + 1}`;
    });
  }

  inferColumnTypes(rows: DataRow[], headers: string[]): ColumnProfile[] {
    return headers.map((name) => {
      const values = rows.map((row) => row[name]);
      const nullCount = values.filter((value) => isEmptyCell(value)).length;
      const distinct = new Set(
        values.filter((value) => !isEmptyCell(value)).map((value) => JSON.stringify(value)),
      );
      return {
        name,
        normalizedName: name,
        type: inferTypeFromValues(values),
        nullCount,
        distinctCount: distinct.size,
      };
    });
  }

  cleanData(sheet: SheetData, options: CleanOptions = {}) {
    const {
      dropEmptyRows = true,
      dropDuplicateRows = true,
      trimStrings = true,
    } = options;

    let emptyRemoved = 0;
    let duplicatesRemoved = 0;
    let rows = sheet.rows.map((row) => {
      if (!trimStrings) return { ...row };
      const next: DataRow = {};
      for (const [key, value] of Object.entries(row)) {
        next[key] = typeof value === 'string' ? value.trim() : value;
      }
      return next;
    });

    if (dropEmptyRows) {
      const before = rows.length;
      rows = rows.filter((row) => sheet.headers.some((header) => !isEmptyCell(row[header])));
      emptyRemoved = before - rows.length;
    }

    if (dropDuplicateRows) {
      const seen = new Set<string>();
      const next: DataRow[] = [];
      for (const row of rows) {
        const key = rowKey(row, sheet.headers);
        if (seen.has(key)) {
          duplicatesRemoved += 1;
          continue;
        }
        seen.add(key);
        next.push(row);
      }
      rows = next;
    }

    const cleaned: SheetData = {
      ...sheet,
      rows,
      columnProfiles: this.inferColumnTypes(rows, sheet.headers),
    };
    return { sheet: cleaned, emptyRemoved, duplicatesRemoved };
  }

  filterData(rows: DataRow[], rules: FilterRule[]): DataRow[] {
    return rows.filter((row) =>
      rules.every((rule) => {
        const value = row[rule.column];
        switch (rule.operator) {
          case 'empty':
            return isEmptyCell(value);
          case 'notEmpty':
            return !isEmptyCell(value);
          case 'eq':
            return String(value) === String(rule.value);
          case 'neq':
            return String(value) !== String(rule.value);
          case 'contains':
            return String(value ?? '').includes(String(rule.value ?? ''));
          case 'gt':
          case 'gte':
          case 'lt':
          case 'lte': {
            const left = parseNumber(value);
            const right = parseNumber(rule.value);
            if (left === null || right === null) return false;
            if (rule.operator === 'gt') return left > right;
            if (rule.operator === 'gte') return left >= right;
            if (rule.operator === 'lt') return left < right;
            return left <= right;
          }
          default:
            return true;
        }
      }),
    );
  }

  sortData(rows: DataRow[], rules: SortRule[]): DataRow[] {
    const copy = [...rows];
    copy.sort((a, b) => {
      for (const rule of rules) {
        const cmp = compareValues(a[rule.column], b[rule.column]);
        if (cmp !== 0) return rule.direction === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
    return copy;
  }

  groupData(rows: DataRow[], groupBy: string[]): Array<Record<string, unknown>> {
    if (!groupBy.length) return [];
    const map = new Map<string, DataRow[]>();
    for (const row of rows) {
      const key = groupBy.map((column) => JSON.stringify(row[column] ?? null)).join('|');
      const bucket = map.get(key) ?? [];
      bucket.push(row);
      map.set(key, bucket);
    }
    return [...map.entries()].map(([, bucket]) => {
      const group: Record<string, unknown> = { count: bucket.length };
      groupBy.forEach((column) => {
        group[column] = bucket[0]?.[column] ?? null;
      });
      return group;
    });
  }

  aggregateData(rows: DataRow[], specs: AggregateSpec[]): Record<string, number | null> {
    const result: Record<string, number | null> = {};
    for (const spec of specs) {
      const key = spec.as || `${spec.op}_${spec.column}`;
      result[key] = aggregateValue(
        rows.map((row) => row[spec.column]),
        spec.op,
      );
    }
    return result;
  }

  detectAnomalies(rows: DataRow[], profiles: ColumnProfile[]): AnomalyMark[] {
    const marks: AnomalyMark[] = [];
    for (const profile of profiles) {
      const values = rows.map((row) => row[profile.name]);
      values.forEach((value, rowIndex) => {
        if (isEmptyCell(value)) {
          marks.push({
            rowIndex,
            column: profile.name,
            reason: 'null',
            value,
          });
          return;
        }
        if (profile.type === 'number' && parseNumber(value) === null) {
          marks.push({
            rowIndex,
            column: profile.name,
            reason: 'type_mismatch',
            value,
          });
        }
      });

      if (profile.type === 'number') {
        const nums = values
          .map((value) => parseNumber(value))
          .filter((value): value is number => value !== null)
          .sort((a, b) => a - b);
        if (nums.length >= 8) {
          const q1 = nums[Math.floor(nums.length * 0.25)]!;
          const q3 = nums[Math.floor(nums.length * 0.75)]!;
          const iqr = q3 - q1;
          const low = q1 - 1.5 * iqr;
          const high = q3 + 1.5 * iqr;
          values.forEach((value, rowIndex) => {
            const num = parseNumber(value);
            if (num !== null && (num < low || num > high)) {
              marks.push({
                rowIndex,
                column: profile.name,
                reason: 'outlier',
                value,
              });
            }
          });
        }
      }
    }
    return marks;
  }

  executeTemplate(input: {
    templateCode: string;
    sheet: SheetData;
    templateVersion?: string;
  }): TemplateExecutionResult {
    return executeTaskTemplate(input);
  }

  buildStructuredResult(input: {
    fileName: string;
    sheet: SheetData;
    aggregates?: AggregateSpec[];
    groupBy?: string[];
    previewLimit?: number;
    quality?: { emptyRowRemoved: number; duplicateRowRemoved: number };
  }): StructuredResult {
    const previewLimit = input.previewLimit ?? 50;
    const aggregates = this.aggregateData(
      input.sheet.rows,
      input.aggregates ??
        input.sheet.columnProfiles
          .filter((profile) => profile.type === 'number')
          .flatMap((profile) => [
            { column: profile.name, op: 'count' as const },
            { column: profile.name, op: 'sum' as const },
            { column: profile.name, op: 'avg' as const },
            { column: profile.name, op: 'min' as const },
            { column: profile.name, op: 'max' as const },
          ]),
    );
    const anomalies = this.detectAnomalies(input.sheet.rows, input.sheet.columnProfiles);
    const nullCellCount = input.sheet.columnProfiles.reduce(
      (sum, profile) => sum + profile.nullCount,
      0,
    );

    return {
      meta: {
        fileName: input.fileName,
        sheetName: input.sheet.name,
        rowCount: input.sheet.rows.length,
        columnCount: input.sheet.headers.length,
        generatedAt: new Date().toISOString(),
      },
      columns: input.sheet.columnProfiles,
      previewRows: input.sheet.rows.slice(0, previewLimit),
      aggregates,
      groups: input.groupBy?.length
        ? this.groupData(input.sheet.rows, input.groupBy)
        : undefined,
      anomalies: anomalies.slice(0, 200),
      quality: {
        emptyRowRemoved: input.quality?.emptyRowRemoved ?? 0,
        duplicateRowRemoved: input.quality?.duplicateRowRemoved ?? 0,
        nullCellCount,
      },
    };
  }

  exportResult(
    rows: DataRow[],
    format: 'csv' | 'xlsx',
    sheetName = 'Result',
  ): Uint8Array | string {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    if (format === 'csv') {
      return XLSX.utils.sheet_to_csv(worksheet);
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31) || 'Result');
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as number[];
    return new Uint8Array(buffer);
  }
}

export const dataEngine = new LocalDataEngine();
