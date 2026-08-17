import type { DataRow } from '../../types.js';

export function normalizeHeaderKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./\\（）()【】\[\]]+/g, '');
}

export type FieldAliasMap = Record<string, string[]>;

export function matchCanonicalField(header: string, aliases: FieldAliasMap): string | null {
  const normalizedHeader = normalizeHeaderKey(header);
  for (const [canonical, aliasList] of Object.entries(aliases)) {
    const candidates = [canonical, ...aliasList].map(normalizeHeaderKey);
    if (candidates.includes(normalizedHeader)) return canonical;
  }
  return null;
}

export function remapRowHeaders(row: DataRow, aliases: FieldAliasMap): DataRow {
  const next: DataRow = {};
  for (const [header, value] of Object.entries(row)) {
    const canonical = matchCanonicalField(header, aliases) ?? header;
    if (next[canonical] === undefined || next[canonical] === null || next[canonical] === '') {
      next[canonical] = value;
    }
  }
  return next;
}

export function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/,/g, '');
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

export function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function roundQty(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
