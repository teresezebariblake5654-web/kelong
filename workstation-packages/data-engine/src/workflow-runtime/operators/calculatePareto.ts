import type { DataRow } from '../../types.js';
import { asText, parseNumeric, roundQty } from './fieldUtils.js';

export type ParetoRow = DataRow & {
  defectType: string;
  defectQty: number;
  defectShare: number;
  cumulativeShare: number;
  isParetoMajor: boolean;
};

export function calculatePareto(
  rows: DataRow[],
  options: {
    typeField?: string;
    qtyField?: string;
    threshold?: number;
  } = {},
): ParetoRow[] {
  const typeField = options.typeField ?? 'defectType';
  const qtyField = options.qtyField ?? 'failedQty';
  const threshold = options.threshold ?? 0.8;

  const grouped = new Map<string, number>();
  for (const row of rows) {
    const type = asText(row[typeField]) || 'UNKNOWN';
    const qty = parseNumeric(row[qtyField]) ?? 0;
    if (qty <= 0) continue;
    grouped.set(type, (grouped.get(type) ?? 0) + qty);
  }

  const total = [...grouped.values()].reduce((sum, n) => sum + n, 0);
  const sorted = [...grouped.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0], 'en');
  });

  let cumulative = 0;
  return sorted.map(([defectType, defectQty]) => {
    const defectShare = total > 0 ? defectQty / total : 0;
    cumulative += defectShare;
    return {
      defectType,
      defectQty,
      defectShare: roundQty(defectShare, 8),
      cumulativeShare: roundQty(cumulative, 8),
      isParetoMajor: cumulative - defectShare < threshold,
    };
  });
}

export function groupTrace(
  rows: DataRow[],
  keyFields: string[],
): Array<{ key: string; rows: DataRow[]; count: number }> {
  const map = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = keyFields.map((field) => asText(row[field])).join('||');
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.entries()].map(([key, list]) => ({
    key,
    rows: list,
    count: list.length,
  }));
}
