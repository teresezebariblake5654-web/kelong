import type { DataRow } from '../../types.js';
import { asText } from './fieldUtils.js';
import {
  Decimal,
  moneyAdd,
  moneyDiv,
  moneyMul,
  moneyRound,
  moneySub,
  moneyToFixed,
  toDecimal,
} from './money.js';
import { normalizeDate } from './normalizeDate.js';
import { daysBetween } from './dateWindow.js';

export function normalizeMoney(value: unknown): { ok: true; value: Decimal } | { ok: false; reason: string } {
  try {
    if (value === null || value === undefined || value === '') {
      return { ok: false, reason: 'EMPTY_AMOUNT' };
    }
    const text = String(value).trim().replace(/,/g, '').replace(/￥|¥|\$/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(text)) return { ok: false, reason: 'INVALID_AMOUNT' };
    return { ok: true, value: new Decimal(text) };
  } catch {
    return { ok: false, reason: 'INVALID_AMOUNT' };
  }
}

export function normalizeSignedMoney(
  value: unknown,
  direction?: unknown,
): { ok: true; value: Decimal; direction: 'IN' | 'OUT' | 'FLAT' } | { ok: false; reason: string } {
  const parsed = normalizeMoney(value);
  if (!parsed.ok) return parsed;
  const dirText = asText(direction).toUpperCase();
  let signed = parsed.value;
  let directionNorm: 'IN' | 'OUT' | 'FLAT' = signed.isZero()
    ? 'FLAT'
    : signed.gt(0)
      ? 'IN'
      : 'OUT';
  if (['OUT', 'DEBIT', 'PAYMENT', '支出', '借'].includes(dirText)) {
    signed = parsed.value.abs().neg();
    directionNorm = 'OUT';
  } else if (['IN', 'CREDIT', 'RECEIPT', '收入', '贷'].includes(dirText)) {
    signed = parsed.value.abs();
    directionNorm = 'IN';
  }
  return { ok: true, value: signed, direction: directionNorm };
}

export function financialControlTotal(rows: DataRow[], field: string): string {
  let sum = moneyAdd(0);
  for (const row of rows) {
    const parsed = normalizeMoney(row[field]);
    if (parsed.ok) sum = moneyAdd(sum, parsed.value);
  }
  return moneyToFixed(sum);
}

export function exactMatch(left: DataRow, right: DataRow, keys: string[]): boolean {
  return keys.every((key) => asText(left[key]).toLowerCase() === asText(right[key]).toLowerCase());
}

export function scoredMatch(input: {
  amountDiff: Decimal;
  dateDiffDays: number;
  counterpartySimilarity: number;
  referenceSimilarity: number;
  amountTolerance: Decimal;
  dateToleranceDays: number;
  weights?: { amount?: number; date?: number; counterparty?: number; reference?: number };
}): number {
  const w = {
    amount: input.weights?.amount ?? 0.4,
    date: input.weights?.date ?? 0.25,
    counterparty: input.weights?.counterparty ?? 0.2,
    reference: input.weights?.reference ?? 0.15,
  };
  const amountScore = input.amountDiff.lte(input.amountTolerance)
    ? moneyDiv(moneySub(input.amountTolerance, input.amountDiff), moneyAdd(input.amountTolerance, '0.0001')).toNumber()
    : 0;
  const dateScore =
    input.dateDiffDays <= input.dateToleranceDays
      ? Math.max(0, 1 - input.dateDiffDays / Math.max(input.dateToleranceDays, 1))
      : 0;
  return (
    amountScore * w.amount +
    dateScore * w.date +
    input.counterpartySimilarity * w.counterparty +
    input.referenceSimilarity * w.reference
  );
}

export function subsetMatchAmounts(
  target: Decimal,
  candidates: Decimal[],
  options?: { maxSubsetSize?: number; tolerance?: Decimal },
): number[] | null {
  const maxSize = options?.maxSubsetSize ?? 4;
  const tolerance = options?.tolerance ?? new Decimal('0.01');
  const n = Math.min(candidates.length, 12);
  const limit = 1 << n;
  let best: number[] | null = null;
  for (let mask = 1; mask < limit; mask += 1) {
    const indexes: number[] = [];
    let sum = new Decimal(0);
    for (let i = 0; i < n; i += 1) {
      if (mask & (1 << i)) {
        indexes.push(i);
        sum = sum.plus(candidates[i]!);
        if (indexes.length > maxSize) break;
      }
    }
    if (indexes.length === 0 || indexes.length > maxSize) continue;
    if (sum.minus(target).abs().lte(tolerance)) {
      if (!best || indexes.length < best.length) best = indexes;
    }
  }
  return best;
}

export type AgingBucket =
  | '未到期'
  | '1-30'
  | '31-60'
  | '61-90'
  | '91-180'
  | '180+';

export function agingBucket(overdueDays: number): AgingBucket {
  if (overdueDays <= 0) return '未到期';
  if (overdueDays <= 30) return '1-30';
  if (overdueDays <= 60) return '31-60';
  if (overdueDays <= 90) return '61-90';
  if (overdueDays <= 180) return '91-180';
  return '180+';
}

export function accountMapping(input: {
  expenseType?: unknown;
  documentType?: unknown;
  description?: unknown;
  mappingRows: DataRow[];
  defaultAccount?: string;
}): { accountCode: string; source: string; conflict: boolean } {
  const type = asText(input.expenseType).toLowerCase();
  const doc = asText(input.documentType).toLowerCase();
  const desc = asText(input.description).toLowerCase();
  const byType = input.mappingRows.filter(
    (row) => asText(row.expenseType || row.keyword).toLowerCase() === type && type,
  );
  const byDoc = input.mappingRows.filter(
    (row) => asText(row.documentType || row.keyword).toLowerCase() === doc && doc,
  );
  const byKeyword = input.mappingRows.filter((row) => {
    const kw = asText(row.keyword).toLowerCase();
    return kw && desc.includes(kw);
  });
  const candidates = [...byType, ...byDoc, ...byKeyword];
  const codes = [...new Set(candidates.map((row) => asText(row.accountCode)).filter(Boolean))];
  if (codes.length > 1) {
    return { accountCode: codes[0]!, source: 'CONFLICT', conflict: true };
  }
  if (codes.length === 1) {
    const source = byType.length
      ? 'TYPE'
      : byDoc.length
        ? 'DOCUMENT'
        : 'KEYWORD';
    return { accountCode: codes[0]!, source, conflict: false };
  }
  if (input.defaultAccount) {
    return { accountCode: input.defaultAccount, source: 'DEFAULT', conflict: false };
  }
  return { accountCode: '', source: 'MANUAL', conflict: false };
}

export function fuzzyDuplicateTransaction(input: {
  rows: DataRow[];
  windowDays: number;
  amountTolerance: Decimal;
}): Array<{ leftIndex: number; rightIndex: number; score: number; reason: string }> {
  const out: Array<{ leftIndex: number; rightIndex: number; score: number; reason: string }> = [];
  for (let i = 0; i < input.rows.length; i += 1) {
    for (let j = i + 1; j < input.rows.length; j += 1) {
      const a = input.rows[i]!;
      const b = input.rows[j]!;
      const personSame =
        asText(a.employeeOrVendor || a.partyCode || a.employeeId).toLowerCase() ===
        asText(b.employeeOrVendor || b.partyCode || b.employeeId).toLowerCase();
      if (!personSame) continue;
      const amountA = normalizeMoney(a.totalAmount ?? a.amount);
      const amountB = normalizeMoney(b.totalAmount ?? b.amount);
      if (!amountA.ok || !amountB.ok) continue;
      if (amountA.value.minus(amountB.value).abs().gt(input.amountTolerance)) continue;
      const dateA = normalizeDate(a.date ?? a.invoiceDate);
      const dateB = normalizeDate(b.date ?? b.invoiceDate);
      if (!dateA.ok || !dateB.ok) continue;
      const gap = Math.abs(daysBetween(dateA.value, dateB.value) ?? 9999);
      if (gap > input.windowDays) continue;
      const descSame =
        asText(a.description).toLowerCase() === asText(b.description).toLowerCase() &&
        asText(a.description) !== '';
      const invoiceSame =
        asText(a.invoiceNo || a.invoiceNumber).toLowerCase() ===
          asText(b.invoiceNo || b.invoiceNumber).toLowerCase() &&
        asText(a.invoiceNo || a.invoiceNumber) !== '';
      let score = 0.5;
      const reasons: string[] = ['同人同金额日期窗口'];
      if (descSame) {
        score += 0.25;
        reasons.push('描述相同');
      }
      if (invoiceSame) {
        score += 0.25;
        reasons.push('发票相同');
      }
      out.push({ leftIndex: i, rightIndex: j, score, reason: reasons.join(';') });
    }
  }
  return out;
}

export function financialPeriod(runDate: string, mode: 'MONTH' | 'WEEK' = 'MONTH'): string {
  if (mode === 'WEEK') {
    const d = new Date(`${runDate}T00:00:00Z`);
    const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getUTCDay() + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  return runDate.slice(0, 7);
}

export function allocateExpense(input: {
  amount: Decimal;
  units: Array<{ key: string; weight: Decimal }>;
  method: 'DIRECT' | 'REVENUE_SHARE' | 'FIXED_RATIO';
}): Array<{ key: string; allocated: Decimal }> {
  if (input.units.length === 0) return [];
  if (input.method === 'DIRECT' && input.units.length === 1) {
    return [{ key: input.units[0]!.key, allocated: moneyRound(input.amount) }];
  }
  const weightSum = input.units.reduce((acc, u) => acc.plus(u.weight), new Decimal(0));
  if (weightSum.isZero()) {
    const even = moneyDiv(input.amount, input.units.length);
    const rows = input.units.map((u) => ({ key: u.key, allocated: moneyRound(even) }));
    return applyAllocationRemainder(input.amount, rows);
  }
  const rows = input.units.map((u) => ({
    key: u.key,
    allocated: moneyRound(moneyMul(input.amount, moneyDiv(u.weight, weightSum))),
  }));
  return applyAllocationRemainder(input.amount, rows);
}

function applyAllocationRemainder(
  original: Decimal,
  rows: Array<{ key: string; allocated: Decimal }>,
): Array<{ key: string; allocated: Decimal }> {
  const sorted = [...rows].sort((a, b) => {
    const cmp = b.allocated.comparedTo(a.allocated);
    if (cmp !== 0) return cmp;
    return a.key.localeCompare(b.key);
  });
  const sum = sorted.reduce((acc, row) => acc.plus(row.allocated), new Decimal(0));
  const diff = moneyRound(original).minus(sum);
  if (!diff.isZero() && sorted[0]) {
    sorted[0] = { ...sorted[0], allocated: sorted[0].allocated.plus(diff) };
  }
  return sorted;
}

export function sanitizeFinancialSummary(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    ...payload,
    rawRows: false,
    containsPii: false,
    containsCustomerNames: false,
    containsInvoiceNumbers: false,
    containsLocalPaths: false,
  };
}

export function textSimilarity(a: unknown, b: unknown): number {
  const left = asText(a).toLowerCase();
  const right = asText(b).toLowerCase();
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.8;
  const setA = new Set(left.split(/\s+/));
  const setB = new Set(right.split(/\s+/));
  let inter = 0;
  for (const token of setA) if (setB.has(token)) inter += 1;
  return inter / Math.max(setA.size, setB.size, 1);
}

export function parseYmdOrNull(value: unknown): string | null {
  const parsed = normalizeDate(value);
  return parsed.ok ? parsed.value : null;
}

export function overdueDays(runDate: string, dueDate: unknown): number | null {
  const due = parseYmdOrNull(dueDate);
  if (!due) return null;
  return Math.max(daysBetween(due, runDate) ?? 0, 0);
}

export { moneyAdd, moneySub, moneyMul, moneyDiv, moneyToFixed, moneyRound, toDecimal, Decimal };
