import type { DataRow } from '../../types.js';
import { asText } from './fieldUtils.js';
import { normalizeDate } from './normalizeDate.js';

export type DuplicateStrategy = 'LATEST' | 'BLOCK';

export function detectDuplicateRecords(
  rows: DataRow[],
  options: {
    keyFields: string[];
    strategy: DuplicateStrategy;
    dateField?: string;
  },
): {
  unique: DataRow[];
  duplicates: DataRow[];
  blockedGroups: DataRow[][];
} {
  const dateField = options.dateField ?? 'inspectionDate';
  const groups = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = options.keyFields.map((field) => asText(row[field]).toLowerCase()).join('||');
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const unique: DataRow[] = [];
  const duplicates: DataRow[] = [];
  const blockedGroups: DataRow[][] = [];

  for (const list of groups.values()) {
    if (list.length === 1) {
      unique.push(list[0]!);
      continue;
    }
    if (options.strategy === 'BLOCK') {
      blockedGroups.push(list);
      duplicates.push(...list.map((row) => ({ ...row, _duplicate: true })));
      continue;
    }
    const ranked = [...list].sort((a, b) => {
      const da = normalizeDate(a[dateField]);
      const db = normalizeDate(b[dateField]);
      const sa = da.ok ? da.value : '';
      const sb = db.ok ? db.value : '';
      return sb.localeCompare(sa);
    });
    unique.push({ ...ranked[0]!, _duplicateWinner: true });
    duplicates.push(
      ...ranked.slice(1).map((row) => ({
        ...row,
        _duplicate: true,
        selectedSourceTrace: `${asText(ranked[0]!._sourceFile)}#${asText(ranked[0]!._sourceSheet)}:${asText(ranked[0]!._sourceRow)}`,
      })),
    );
  }

  return { unique, duplicates, blockedGroups };
}
