import type { DataRow } from '../../types.js';
import { asText, parseNumeric, roundQty } from './fieldUtils.js';
import { aggregateRows } from './aggregate.js';

/**
 * Aggregate rows by date / composite keys with deterministic date sort
 * and optional cumulative metrics.
 */
export function aggregateTimeSeries(
  rows: DataRow[],
  options: {
    groupBy: string[];
    dateField?: string;
    metrics: Parameters<typeof aggregateRows>[1]['metrics'];
    cumulativeFields?: string[];
    movingAverageField?: string;
    movingAverageWindow?: number;
  },
): DataRow[] {
  const dateField = options.dateField ?? 'reportDate';
  const aggregated = aggregateRows(rows, {
    groupBy: options.groupBy,
    metrics: options.metrics,
  });

  aggregated.sort((a, b) => {
    const dateCmp = asText(a[dateField]).localeCompare(asText(b[dateField]));
    if (dateCmp !== 0) return dateCmp;
    for (const key of options.groupBy) {
      if (key === dateField) continue;
      const cmp = asText(a[key]).localeCompare(asText(b[key]));
      if (cmp !== 0) return cmp;
    }
    return 0;
  });

  if (!options.cumulativeFields?.length && !options.movingAverageField) {
    return aggregated;
  }

  const buckets = new Map<string, DataRow[]>();
  for (const row of aggregated) {
    const key = options.groupBy
      .filter((field) => field !== dateField)
      .map((field) => asText(row[field]).toLowerCase())
      .join('||');
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }

  const out: DataRow[] = [];
  for (const list of buckets.values()) {
    const running: Record<string, number> = {};
    const windowValues: number[] = [];
    for (const row of list) {
      const next: DataRow = { ...row };
      for (const field of options.cumulativeFields ?? []) {
        const value = parseNumeric(row[field]) ?? 0;
        running[field] = (running[field] ?? 0) + value;
        next[`cumulative_${field}`] = roundQty(running[field]!);
      }
      if (options.movingAverageField) {
        const value = parseNumeric(row[options.movingAverageField]) ?? 0;
        windowValues.push(value);
        const window = options.movingAverageWindow ?? 3;
        while (windowValues.length > window) windowValues.shift();
        const avg =
          windowValues.reduce((sum, item) => sum + item, 0) / windowValues.length;
        next[`ma_${options.movingAverageField}`] = roundQty(avg, 6);
      }
      out.push(next);
    }
  }

  out.sort((a, b) => {
    const dateCmp = asText(a[dateField]).localeCompare(asText(b[dateField]));
    if (dateCmp !== 0) return dateCmp;
    return asText(a.workOrderNo).localeCompare(asText(b.workOrderNo));
  });
  return out;
}

export function calculateCumulativeMetrics(
  rows: DataRow[],
  options: {
    groupBy: string[];
    fields: string[];
    dateField?: string;
  },
): DataRow[] {
  return aggregateTimeSeries(rows, {
    groupBy: options.groupBy,
    dateField: options.dateField,
    metrics: Object.fromEntries(
      options.fields.map((field) => [field, { field, op: 'sum' as const }]),
    ),
    cumulativeFields: options.fields,
  });
}
