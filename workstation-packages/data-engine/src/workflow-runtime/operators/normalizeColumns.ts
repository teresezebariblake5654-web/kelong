import type { DataRow } from '../../types.js';
import { asText, remapRowHeaders, type FieldAliasMap } from './fieldUtils.js';

export function normalizeColumns(
  rows: DataRow[],
  aliases: FieldAliasMap,
  options?: {
    /** Excel-style 1-based source row offset for first data row (default 2 = header + 1). */
    sourceRowBase?: number;
    role?: string;
    sourceFile?: string;
    sourceSheet?: string;
    inputSha256?: string;
  },
): DataRow[] {
  const base = options?.sourceRowBase ?? 2;
  return rows.map((row, index) => {
    const mapped = remapRowHeaders(row, aliases);
    return {
      ...mapped,
      _sourceRow: index + base,
      _role: options?.role ?? mapped._role,
      _sourceFile: options?.sourceFile ?? mapped._sourceFile,
      _sourceSheet: options?.sourceSheet ?? mapped._sourceSheet,
      _inputSha256: options?.inputSha256 ?? mapped._inputSha256,
    };
  });
}

export function hasBlank(value: unknown): boolean {
  return asText(value) === '';
}
