import type { DataRow } from '../../types.js';

export type ExceptionClass =
  | 'WRONG_MATERIAL'
  | 'MISSING_BOM'
  | 'MISSING_OUTPUT'
  | 'MISSING_ACTUAL_USAGE'
  | 'OVERUSE'
  | 'UNDERUSE'
  | 'NEGATIVE_USAGE'
  | 'UNIT_MISMATCH'
  | 'DUPLICATE_BOM'
  | 'INVALID_DATA'
  | 'SUBSTITUTE_NOT_ALLOWED'
  | 'NORMAL';

export type ClassifyRule = {
  code: ExceptionClass | string;
  when: (row: DataRow) => boolean;
  severity?: 'INFO' | 'WARNING' | 'BLOCKING';
  reason?: string | ((row: DataRow) => string);
};

/**
 * Attach status/reason based on ordered classification rules.
 * First matching non-NORMAL rule wins for primary status; all matches collected in statuses[].
 */
export function classifyRows(
  rows: DataRow[],
  rules: ClassifyRule[],
  options?: {
    statusField?: string;
    reasonField?: string;
  },
): DataRow[] {
  const statusField = options?.statusField ?? 'status';
  const reasonField = options?.reasonField ?? 'reason';

  return rows.map((row) => {
    const matched: Array<{ code: string; severity: string; reason: string }> = [];
    for (const rule of rules) {
      if (!rule.when(row)) continue;
      const reason =
        typeof rule.reason === 'function'
          ? rule.reason(row)
          : rule.reason ?? rule.code;
      matched.push({
        code: rule.code,
        severity: rule.severity ?? 'WARNING',
        reason,
      });
    }
    const primary = matched.find((item) => item.code !== 'NORMAL') ?? matched[0];
    return {
      ...row,
      [statusField]: primary?.code ?? 'NORMAL',
      [reasonField]: primary?.reason ?? '',
      statuses: matched.map((item) => item.code).join('|') || 'NORMAL',
      _classification: matched,
    };
  });
}

export function filterRows(
  rows: DataRow[],
  predicate: (row: DataRow) => boolean,
): DataRow[] {
  return rows.filter(predicate);
}
