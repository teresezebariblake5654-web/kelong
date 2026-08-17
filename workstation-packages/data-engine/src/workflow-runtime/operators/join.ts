import type { DataRow } from '../../types.js';

export type JoinType = 'inner' | 'left' | 'full';

export function rowKey(row: DataRow, keys: string[]): string {
  return keys.map((key) => String(row[key] ?? '').trim().toLowerCase()).join('||');
}

export function joinRows(input: {
  left: DataRow[];
  right: DataRow[];
  keys: string[];
  joinType?: JoinType;
  leftPrefix?: string;
  rightPrefix?: string;
}): DataRow[] {
  const joinType = input.joinType ?? 'full';
  const leftMap = new Map<string, DataRow[]>();
  const rightMap = new Map<string, DataRow[]>();

  for (const row of input.left) {
    const key = rowKey(row, input.keys);
    const list = leftMap.get(key) ?? [];
    list.push(row);
    leftMap.set(key, list);
  }
  for (const row of input.right) {
    const key = rowKey(row, input.keys);
    const list = rightMap.get(key) ?? [];
    list.push(row);
    rightMap.set(key, list);
  }

  const keys = new Set<string>([...leftMap.keys(), ...rightMap.keys()]);
  const out: DataRow[] = [];

  for (const key of keys) {
    const leftRows = leftMap.get(key) ?? [];
    const rightRows = rightMap.get(key) ?? [];

    if (leftRows.length === 0) {
      if (joinType === 'inner' || joinType === 'left') continue;
      for (const right of rightRows) out.push({ ...right });
      continue;
    }
    if (rightRows.length === 0) {
      if (joinType === 'inner') continue;
      for (const left of leftRows) out.push({ ...left });
      continue;
    }

    for (const left of leftRows) {
      for (const right of rightRows) {
        out.push({ ...left, ...right });
      }
    }
  }

  return out;
}
