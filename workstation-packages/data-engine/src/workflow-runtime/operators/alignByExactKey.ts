import type { DataRow } from '../../types.js';
import { asText } from './fieldUtils.js';

export type AlignByExactKeyResult = {
  matched: Array<{ left: DataRow; right: DataRow | null; key: string }>;
  leftOnly: DataRow[];
  rightOnly: DataRow[];
  leftConflicts: DataRow[];
  rightConflicts: DataRow[];
};

/**
 * Exact-key alignment (e.g. workOrderNo). Never fuzzy-matches.
 * Duplicate keys on either side are reported as conflicts.
 */
export function alignByExactKey(
  left: DataRow[],
  right: DataRow[],
  options: {
    keyField: string;
    allowMultipleRight?: boolean;
  },
): AlignByExactKeyResult {
  const keyField = options.keyField;
  const leftMap = new Map<string, DataRow[]>();
  const rightMap = new Map<string, DataRow[]>();

  for (const row of left) {
    const key = asText(row[keyField]).toLowerCase();
    if (!key) continue;
    const list = leftMap.get(key) ?? [];
    list.push(row);
    leftMap.set(key, list);
  }
  for (const row of right) {
    const key = asText(row[keyField]).toLowerCase();
    if (!key) continue;
    const list = rightMap.get(key) ?? [];
    list.push(row);
    rightMap.set(key, list);
  }

  const leftConflicts: DataRow[] = [];
  const rightConflicts: DataRow[] = [];
  const matched: AlignByExactKeyResult['matched'] = [];
  const leftOnly: DataRow[] = [];
  const rightOnly: DataRow[] = [];

  for (const [key, rows] of leftMap) {
    if (rows.length > 1) {
      leftConflicts.push(...rows.map((row) => ({ ...row, _alignConflict: 'LEFT_DUPLICATE' })));
      continue;
    }
    const rights = rightMap.get(key) ?? [];
    if (rights.length === 0) {
      leftOnly.push(rows[0]!);
      matched.push({ left: rows[0]!, right: null, key });
      continue;
    }
    if (rights.length > 1 && !options.allowMultipleRight) {
      // Multiple reports for one plan are OK when allowMultipleRight; otherwise conflict.
      rightConflicts.push(
        ...rights.map((row) => ({ ...row, _alignConflict: 'RIGHT_DUPLICATE' })),
      );
      matched.push({ left: rows[0]!, right: rights[0]!, key });
      continue;
    }
    matched.push({ left: rows[0]!, right: rights[0]!, key });
  }

  for (const [key, rows] of rightMap) {
    if (!leftMap.has(key)) {
      rightOnly.push(...rows);
    }
  }

  return { matched, leftOnly, rightOnly, leftConflicts, rightConflicts };
}
