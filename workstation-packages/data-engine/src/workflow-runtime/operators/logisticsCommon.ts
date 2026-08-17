import type { DataRow } from '../../types.js';
import { asText } from './fieldUtils.js';
import { daysBetween } from './dateWindow.js';
import { normalizeDate } from './normalizeDate.js';
import { normalizeDateTime } from './normalizeDateTime.js';
import { toDecimal, moneyToFixed } from './money.js';

export function sanitizeLogSummary(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    ...payload,
    rawRows: false,
    containsPii: false,
    containsCustomerNames: false,
    containsPhone: false,
    containsAddress: false,
    containsLocalPaths: false,
  };
}

export function normalizeSku(value: unknown): string {
  return asText(value).trim().toUpperCase();
}

export function normalizeWarehouse(value: unknown): string {
  return asText(value).trim().toUpperCase();
}

export function stockKey(sku: unknown, warehouse: unknown): string {
  return `${normalizeSku(sku)}||${normalizeWarehouse(warehouse)}`;
}

export function qtyNumber(value: unknown): number {
  const n = Number(asText(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/** counted - book (or left - right). */
export function qtyDiff(left: unknown, right: unknown): number {
  const a = qtyNumber(left);
  const b = qtyNumber(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return a - b;
}

export function exceedsQtyTolerance(diff: number, tolerance: string | number): boolean {
  if (!Number.isFinite(diff)) return true;
  const tol = Number(tolerance);
  return Math.abs(diff) > (Number.isFinite(tol) ? Math.abs(tol) : 0);
}

export function withinTolerance(diff: number, tolerance: number): boolean {
  if (!Number.isFinite(diff)) return false;
  return Math.abs(diff) <= Math.abs(tolerance);
}

export function isDelayedShipment(input: {
  eta: unknown;
  status?: unknown;
  runDate: string;
  delayHours: number;
  nowEpochMs?: number;
}): boolean {
  const status = asText(input.status).toLowerCase();
  if (['delivered', '已签收', '已送达', 'cancelled', '已取消', 'completed', '完成'].includes(status)) {
    return false;
  }
  const etaDt = normalizeDateTime(input.eta);
  if (etaDt.ok) {
    const now = input.nowEpochMs ?? Date.parse(`${input.runDate}T23:59:59.000Z`);
    return (now - etaDt.epochMs) / 3_600_000 > input.delayHours;
  }
  const etaDate = normalizeDate(input.eta);
  if (!etaDate.ok) return false;
  const days = daysBetween(etaDate.value, input.runDate);
  if (days === null || days <= 0) return false;
  return days * 24 > input.delayHours;
}

export function hoursSince(input: {
  eventTime: unknown;
  runDate: string;
  nowEpochMs?: number;
}): number | null {
  const dt = normalizeDateTime(input.eventTime);
  if (dt.ok) {
    const now = input.nowEpochMs ?? Date.parse(`${input.runDate}T23:59:59.000Z`);
    return (now - dt.epochMs) / 3_600_000;
  }
  const d = normalizeDate(input.eventTime);
  if (!d.ok) return null;
  const days = daysBetween(d.value, input.runDate);
  return days === null ? null : days * 24;
}

export function hoursBetween(fromDate: unknown, toDate: unknown): number | null {
  const a = normalizeDate(fromDate);
  const b = normalizeDate(toDate);
  if (!a.ok || !b.ok) return null;
  const days = daysBetween(a.value, b.value);
  return days === null ? null : days * 24;
}

export function daysSince(runDate: string, fromDate: unknown): number | null {
  const parsed = normalizeDate(fromDate);
  if (!parsed.ok) return null;
  return daysBetween(parsed.value, runDate);
}

export function normalizeShipmentStatus(value: unknown): string {
  const key = asText(value).toLowerCase();
  if (!key) return 'UNKNOWN';
  if (['delivered', '已签收', '签收', '已送达'].includes(key)) return 'DELIVERED';
  if (['in_transit', '在途', '运输中', '已发货'].includes(key)) return 'IN_TRANSIT';
  if (['delayed', '延误', '滞留'].includes(key)) return 'DELAYED';
  if (['exception', '异常', '破损', '退回', '拒收'].includes(key)) return 'EXCEPTION';
  if (['cancelled', '已取消', '取消'].includes(key)) return 'CANCELLED';
  if (['pending', '待发货', '已揽收', 'created', '已创建'].includes(key)) return 'CREATED';
  return 'UNKNOWN';
}

export function normalizeTransferStatus(value: unknown): string {
  const key = asText(value).toLowerCase();
  if (!key) return 'UNKNOWN';
  if (['in_transit', '在途', '已发运', '运输中'].includes(key)) return 'IN_TRANSIT';
  if (['pending_receive', '待收货', '待入库'].includes(key)) return 'PENDING_RECEIVE';
  if (['received', '已收货', '完成', '已完成', 'completed'].includes(key)) return 'COMPLETED';
  if (['pending', '待发运', '草稿', 'draft'].includes(key)) return 'DRAFT';
  if (['cancelled', '已取消'].includes(key)) return 'CANCELLED';
  return 'UNKNOWN';
}

export function countDistinct(rows: DataRow[], field: string): number {
  const set = new Set<string>();
  for (const row of rows) {
    const value = asText(row[field]);
    if (value) set.add(value.toLowerCase());
  }
  return set.size;
}

export function formatQty(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '';
  return moneyToFixed(toDecimal(value), decimals);
}

export { daysBetween, normalizeDate };
