import type { DataRow } from '../../types.js';
import { parseNumeric } from './fieldUtils.js';
import { rowKey } from './join.js';

export type AggregateMetricOp = 'sum' | 'count' | 'min' | 'max' | 'first' | 'last';

export type AggregateMetricSpec = {
  field: string;
  op: AggregateMetricOp;
  as?: string;
};

/**
 * Group rows by business keys and aggregate numeric fields.
 * Reusable across workflows (consumption, daily close, finance, etc.).
 */
export function aggregateRows(
  rows: DataRow[],
  options: {
    groupBy: string[];
    metrics: AggregateMetricSpec[] | Record<string, AggregateMetricOp | AggregateMetricSpec>;
  },
): DataRow[] {
  const metrics: AggregateMetricSpec[] = Array.isArray(options.metrics)
    ? options.metrics
    : Object.entries(options.metrics).map(([as, spec]) =>
        typeof spec === 'string'
          ? { field: as, op: spec, as }
          : { field: spec.field, op: spec.op, as: spec.as ?? as },
      );

  const groups = new Map<string, { seed: DataRow; rows: DataRow[] }>();
  for (const row of rows) {
    const key = rowKey(row, options.groupBy);
    const existing = groups.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(key, { seed: { ...row }, rows: [row] });
    }
  }

  const out: DataRow[] = [];
  for (const group of groups.values()) {
    const result: DataRow = {};
    for (const key of options.groupBy) {
      result[key] = group.seed[key] ?? group.rows[0]?.[key] ?? null;
    }
    for (const metric of metrics) {
      const values = group.rows.map((row) => row[metric.field]);
      const as = metric.as ?? metric.field;
      result[as] = reduceMetric(values, metric.op);
    }
    for (const [key, value] of Object.entries(group.seed)) {
      if (result[key] === undefined) result[key] = value;
    }
    out.push(result);
  }
  return out;
}

function reduceMetric(values: unknown[], op: AggregateMetricOp): unknown {
  if (op === 'count') {
    return values.filter((value) => value !== null && value !== undefined && value !== '').length;
  }
  if (op === 'first') {
    return values.find((value) => value !== null && value !== undefined && value !== '') ?? null;
  }
  if (op === 'last') {
    for (let i = values.length - 1; i >= 0; i -= 1) {
      const value = values[i];
      if (value !== null && value !== undefined && value !== '') return value;
    }
    return null;
  }
  const nums = values
    .map((value) => parseNumeric(value))
    .filter((value): value is number => value !== null);
  if (nums.length === 0) return null;
  if (op === 'sum') return nums.reduce((sum, n) => sum + n, 0);
  if (op === 'min') return Math.min(...nums);
  if (op === 'max') return Math.max(...nums);
  return null;
}
