import type { DataRow } from '../../types.js';
import { asText } from './fieldUtils.js';
import { daysBetween } from './dateWindow.js';
import { normalizeDate } from './normalizeDate.js';
import {
  Decimal,
  financialControlTotal,
  moneyAdd,
  moneyDiv,
  moneyMul,
  moneyRound,
  moneySub,
  moneyToFixed,
  normalizeMoney,
  toDecimal,
} from './financeCommon.js';

const ASSET_STATUS_MAP: Record<string, string> = {
  in_use: 'IN_USE',
  在用: 'IN_USE',
  active: 'IN_USE',
  正常: 'IN_USE',
  idle: 'IDLE',
  闲置: 'IDLE',
  unused: 'IDLE',
  damaged: 'DAMAGED',
  损坏: 'DAMAGED',
  broken: 'DAMAGED',
  in_repair: 'IN_REPAIR',
  维修中: 'IN_REPAIR',
  repair: 'IN_REPAIR',
  scrapped: 'SCRAPPED',
  报废: 'SCRAPPED',
  disposed: 'SCRAPPED',
  missing: 'MISSING',
  盘亏: 'MISSING',
  丢失: 'MISSING',
};

/** Strip sensitive/raw content from ADMIN AI summary payloads. */
export function sanitizeAdminSummary(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    ...payload,
    rawRows: false,
    containsPii: false,
    containsCustomerNames: false,
    containsLocalPaths: false,
    containsEmployeeIds: false,
  };
}

export function normalizeAssetStatus(value: unknown): string {
  const key = asText(value).toLowerCase();
  if (!key) return 'UNKNOWN';
  return ASSET_STATUS_MAP[key] ?? ASSET_STATUS_MAP[asText(value)] ?? 'UNKNOWN';
}

/** Days from runDate to target date (positive = future). */
export function daysUntil(runDate: string, targetDate: unknown): number | null {
  const parsed = normalizeDate(targetDate);
  if (!parsed.ok) return null;
  return daysBetween(runDate, parsed.value);
}

export function assetCodeKey(value: unknown): string {
  return asText(value).trim().toUpperCase();
}

export function contractNoKey(value: unknown): string {
  return asText(value).trim().toUpperCase();
}

export function roomIdKey(value: unknown): string {
  return asText(value).trim().toUpperCase();
}

export function periodFromDate(dateValue: unknown, mode: 'MONTH' | 'QUARTER' | 'WEEK'): string {
  const parsed = normalizeDate(dateValue);
  if (!parsed.ok) return '';
  const ymd = parsed.value;
  if (mode === 'WEEK') {
    const d = new Date(`${ymd}T00:00:00Z`);
    const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(
      ((d.getTime() - onejan.getTime()) / 86_400_000 + onejan.getUTCDay() + 1) / 7,
    );
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  if (mode === 'QUARTER') {
    const month = Number(ymd.slice(5, 7));
    const q = Math.ceil(month / 3);
    return `${ymd.slice(0, 4)}-Q${q}`;
  }
  return ymd.slice(0, 7);
}

export function sumMoneyField(rows: DataRow[], field: string): Decimal {
  let sum = toDecimal(0);
  for (const row of rows) {
    const parsed = normalizeMoney(row[field]);
    if (parsed.ok) sum = moneyAdd(sum, parsed.value);
  }
  return sum;
}

export {
  Decimal,
  financialControlTotal,
  moneyAdd,
  moneyDiv,
  moneyMul,
  moneyRound,
  moneySub,
  moneyToFixed,
  normalizeMoney,
  toDecimal,
};
