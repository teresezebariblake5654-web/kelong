import { createHash } from 'node:crypto';
import type { DataRow } from '../../types.js';
import { asText } from './fieldUtils.js';
import { joinRows } from './join.js';
import { moneyAdd, moneyToFixed } from './money.js';

const SENSITIVE_KEYS = [
  'employeeName',
  'employeeId',
  'idNumber',
  'phone',
  'mobile',
  'email',
  'bankAccount',
  'bankName',
  'candidateName',
];

export function hashSensitive(value: unknown): string {
  const text = asText(value);
  if (!text) return '';
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function maskSensitiveValue(value: unknown, keepTail = 4): string {
  const text = asText(value);
  if (!text) return '';
  if (text.length <= keepTail) return '*'.repeat(text.length);
  return `${'*'.repeat(Math.max(text.length - keepTail, 2))}${text.slice(-keepTail)}`;
}

export function maskEmployeeRow<T extends DataRow>(row: T): T {
  const next: DataRow = { ...row };
  for (const key of SENSITIVE_KEYS) {
    if (next[key] !== undefined && next[key] !== null && next[key] !== '') {
      next[key] = maskSensitiveValue(next[key]);
    }
  }
  return next as T;
}

export function stripSensitiveFromAiPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...payload,
    rawRows: false,
    containsPii: false,
  };
}

export function indexByEmployeeId(rows: DataRow[]): Map<string, DataRow[]> {
  const map = new Map<string, DataRow[]>();
  for (const row of rows) {
    const id = asText(row.employeeId);
    if (!id) continue;
    const list = map.get(id) ?? [];
    list.push(row);
    map.set(id, list);
  }
  return map;
}

/** Join datasets on employeeId only — never auto-merge by name. */
export function joinByEmployeeId(
  left: DataRow[],
  right: DataRow[],
  joinType: 'inner' | 'left' | 'full' = 'left',
): DataRow[] {
  return joinRows({ left, right, keys: ['employeeId'], joinType });
}

export function detectDuplicateKeys(
  rows: DataRow[],
  keyFields: string[],
): { key: string; rows: DataRow[]; count: number }[] {
  const groups = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = keyFields.map((f) => asText(row[f]).toLowerCase()).join('||');
    if (!key || keyFields.every((f) => !asText(row[f]))) continue;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, rows: list, count: list.length }));
}

export function nameMatchCandidates(leftName: string, rightRows: DataRow[]): DataRow[] {
  const target = asText(leftName).toLowerCase();
  if (!target) return [];
  return rightRows.filter((row) => asText(row.employeeName).toLowerCase() === target);
}

export function buildRuleSnapshotRows(
  rules: Record<string, unknown>,
  extras?: Record<string, unknown>,
): DataRow[] {
  const merged = { ...rules, ...(extras ?? {}) };
  return Object.entries(merged).map(([key, value]) => ({
    key,
    value:
      Array.isArray(value) || (value && typeof value === 'object')
        ? JSON.stringify(value)
        : value,
  }));
}

export function buildHrRunNotes(input: {
  workflowId: string;
  workflowVersion: string;
  runDate: string;
  rules: Record<string, unknown>;
  inputSha256ByRole: Map<string, string> | Record<string, string>;
  inputRowCount: number;
  outputRowCount: number;
  exceptionCount: number;
  extras?: Array<{ key: string; value: unknown }>;
}): DataRow[] {
  const shaEntries =
    input.inputSha256ByRole instanceof Map
      ? [...input.inputSha256ByRole.entries()]
      : Object.entries(input.inputSha256ByRole);

  return [
    { key: 'workflowId', value: input.workflowId },
    { key: 'workflowVersion', value: input.workflowVersion },
    { key: 'runDate', value: input.runDate },
    { key: 'executedAt', value: new Date().toISOString() },
    { key: 'cloudUpload', value: false },
    { key: 'aiSummaryPayload.rawRows', value: false },
    { key: 'inputRowCount', value: input.inputRowCount },
    { key: 'outputRowCount', value: input.outputRowCount },
    { key: 'exceptionCount', value: input.exceptionCount },
    ...shaEntries.map(([role, sha]) => ({ key: `inputSha256.${role}`, value: sha })),
    { key: 'companyRulesSnapshot', value: JSON.stringify(input.rules) },
    ...(input.extras ?? []),
  ];
}

export function normalizeEmploymentStatus(raw: unknown): string {
  const original = asText(raw);
  const text = original.toUpperCase();
  if (!text) return 'UNKNOWN';
  if (
    text === 'ACTIVE' ||
    text === 'EMPLOYED' ||
    text === 'ONBOARD' ||
    original.includes('在职') ||
    original.includes('正式') ||
    original.includes('试用')
  ) {
    return 'ACTIVE';
  }
  if (
    text === 'TERMINATED' ||
    text === 'INACTIVE' ||
    text === 'RESIGNED' ||
    text === 'OFFBOARD' ||
    text === 'LEFT' ||
    original.includes('离职')
  ) {
    return 'TERMINATED';
  }
  return text;
}

export function isActiveEmployment(status: unknown): boolean {
  return normalizeEmploymentStatus(status) === 'ACTIVE';
}

export function aggregateExceptionCounts(
  exceptions: Array<{ code: string; severity: 'INFO' | 'WARNING' | 'BLOCKING'; message?: string }>,
): Array<{ code: string; severity: 'INFO' | 'WARNING' | 'BLOCKING'; count: number; message?: string }> {
  const map = new Map<
    string,
    { code: string; severity: 'INFO' | 'WARNING' | 'BLOCKING'; count: number; message?: string }
  >();
  for (const item of exceptions) {
    const prev = map.get(item.code);
    if (prev) prev.count += 1;
    else map.set(item.code, { code: item.code, severity: item.severity, count: 1, message: item.message });
  }
  return [...map.values()];
}

export function controlTotal(rows: DataRow[], field: string): string {
  let sum = moneyAdd(0);
  for (const row of rows) sum = moneyAdd(sum, row[field]);
  return moneyToFixed(sum);
}
