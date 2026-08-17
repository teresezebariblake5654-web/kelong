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
import { normalizeMoney, financialControlTotal } from './financeCommon.js';
import { daysBetween } from './dateWindow.js';
import { normalizeDate } from './normalizeDate.js';

export type PlatformCode =
  | 'shopify'
  | 'taobao'
  | 'tmall'
  | 'jd'
  | 'douyin'
  | 'kuaishou'
  | 'taobao_live'
  | 'generic';

const PLATFORM_ALIASES: Record<string, PlatformCode> = {
  shopify: 'shopify',
  淘宝: 'taobao',
  taobao: 'taobao',
  天猫: 'tmall',
  tmall: 'tmall',
  京东: 'jd',
  jd: 'jd',
  抖音: 'douyin',
  douyin: 'douyin',
  快手: 'kuaishou',
  kuaishou: 'kuaishou',
  淘宝直播: 'taobao_live',
  taobao_live: 'taobao_live',
};

const PAYMENT_STATUS_MAP: Record<string, string> = {
  paid: 'PAID',
  已付款: 'PAID',
  已支付: 'PAID',
  付款成功: 'PAID',
  unpaid: 'UNPAID',
  未付款: 'UNPAID',
  待支付: 'UNPAID',
  pending: 'UNPAID',
  refunded: 'REFUNDED',
  已退款: 'REFUNDED',
  cancelled: 'CANCELLED',
  已取消: 'CANCELLED',
  关闭: 'CANCELLED',
};

const FULFILLMENT_STATUS_MAP: Record<string, string> = {
  unshipped: 'UNSHIPPED',
  待发货: 'UNSHIPPED',
  未发货: 'UNSHIPPED',
  ready: 'UNSHIPPED',
  shipped: 'SHIPPED',
  已发货: 'SHIPPED',
  delivered: 'DELIVERED',
  已签收: 'DELIVERED',
  cancelled: 'CANCELLED',
  已取消: 'CANCELLED',
};

export function normalizePlatform(value: unknown): PlatformCode {
  const key = asText(value).toLowerCase();
  if (!key) return 'generic';
  return PLATFORM_ALIASES[key] ?? PLATFORM_ALIASES[asText(value)] ?? 'generic';
}

export function normalizePaymentStatus(value: unknown): string {
  const key = asText(value).toLowerCase();
  if (!key) return 'UNKNOWN';
  return PAYMENT_STATUS_MAP[key] ?? PAYMENT_STATUS_MAP[asText(value)] ?? 'UNKNOWN';
}

export function normalizeFulfillmentStatus(value: unknown): string {
  const key = asText(value).toLowerCase();
  if (!key) return 'UNKNOWN';
  return FULFILLMENT_STATUS_MAP[key] ?? FULFILLMENT_STATUS_MAP[asText(value)] ?? 'UNKNOWN';
}

export function normalizeOrderStatus(value: unknown): string {
  const text = asText(value).toLowerCase();
  if (!text) return 'UNKNOWN';
  if (['paid', '已付款', '已支付', '待发货'].includes(text)) return 'PAID';
  if (['unpaid', '未付款', '待支付'].includes(text)) return 'UNPAID';
  if (['cancelled', '已取消', '关闭'].includes(text)) return 'CANCELLED';
  if (['refunded', '已退款', '退款中'].includes(text)) return 'REFUNDED';
  if (['shipped', '已发货'].includes(text)) return 'SHIPPED';
  return 'UNKNOWN';
}

/** Unique key: platform + orderNo + lineItemId (fallback sku+qty+itemAmount). */
export function orderLineUniqueKey(row: DataRow): string {
  const platform = normalizePlatform(row.platform);
  const orderNo = asText(row.orderNo);
  const lineItemId = asText(row.lineItemId);
  if (lineItemId) return `${platform}||${orderNo}||${lineItemId}`.toLowerCase();
  return `${platform}||${orderNo}||${asText(row.sku)}||${asText(row.qty)}||${asText(row.itemAmount)}`.toLowerCase();
}

export function countDistinct(rows: DataRow[], field: string): number {
  const set = new Set<string>();
  for (const row of rows) {
    const value = asText(row[field]);
    if (value) set.add(value.toLowerCase());
  }
  return set.size;
}

export function sumQty(rows: DataRow[], field = 'qty'): string {
  let sum = toDecimal(0);
  for (const row of rows) {
    const parsed = normalizeMoney(row[field]);
    if (parsed.ok) sum = moneyAdd(sum, parsed.value);
  }
  return moneyToFixed(sum, 0);
}

/**
 * amountDifference = orderAmount - lineAmountSum - shipping + discount
 * Platform dialects may omit shipping/discount (treated as 0).
 */
export function orderAmountDifference(input: {
  orderAmount: unknown;
  lineAmountSum: Decimal | string;
  shippingAmount?: unknown;
  discountAmount?: unknown;
}): { ok: true; difference: Decimal; orderAmount: Decimal } | { ok: false; reason: string } {
  const order = normalizeMoney(input.orderAmount);
  if (!order.ok) return order;
  const lines =
    typeof input.lineAmountSum === 'string'
      ? normalizeMoney(input.lineAmountSum)
      : { ok: true as const, value: input.lineAmountSum };
  if (!lines.ok) return lines;
  const shipping = normalizeMoney(input.shippingAmount ?? 0);
  const discount = normalizeMoney(input.discountAmount ?? 0);
  const ship = shipping.ok ? shipping.value : toDecimal(0);
  const disc = discount.ok ? discount.value : toDecimal(0);
  const difference = moneySub(moneyAdd(moneySub(order.value, lines.value), disc), ship);
  // formula: orderAmount - lineAmountSum - shipping + discount
  const diff = moneyAdd(moneySub(moneySub(order.value, lines.value), ship), disc);
  void difference;
  return { ok: true, difference: diff, orderAmount: order.value };
}

export function maskPhone(value: unknown): string {
  const text = asText(value).replace(/\s+/g, '');
  if (!text) return '';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

export function maskAddress(value: unknown): string {
  const text = asText(value);
  if (!text) return '';
  if (text.length <= 6) return '*'.repeat(text.length);
  return `${text.slice(0, 6)}${'*'.repeat(Math.min(text.length - 6, 12))}`;
}

export function maskOrder(value: unknown): string {
  const text = asText(value);
  if (!text) return '';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 2)}${'*'.repeat(Math.max(text.length - 4, 4))}${text.slice(-2)}`;
}

export function maskReceiverName(value: unknown): string {
  const text = asText(value);
  if (!text) return '';
  if (text.length === 1) return '*';
  if (text.length === 2) return `${text[0]}*`;
  return `${text[0]}${'*'.repeat(text.length - 2)}${text[text.length - 1]}`;
}

export function sanitizeEcomSummary(payload: Record<string, unknown>): Record<string, unknown> {
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

export function isValidPhone(value: unknown): boolean {
  const text = asText(value).replace(/\s|-/g, '');
  if (!text) return false;
  return /^1[3-9]\d{9}$/.test(text) || /^\+?\d{7,15}$/.test(text);
}

export function hasRequiredAddress(row: DataRow, requiredFields: string[]): boolean {
  return requiredFields.every((field) => {
    const value = asText(row[field]);
    return Boolean(value);
  });
}

export function inventoryOnHand(available: unknown, reserved: unknown = 0): Decimal {
  const a = normalizeMoney(available);
  const r = normalizeMoney(reserved);
  const avail = a.ok ? a.value : toDecimal(0);
  const res = r.ok ? r.value : toDecimal(0);
  return moneySub(avail, res);
}

export function daysOfInventory(
  onHand: Decimal,
  avgDailySales: Decimal | null,
): string | null {
  if (!avgDailySales || avgDailySales.lte(0)) return null;
  return moneyToFixed(moneyDiv(onHand, avgDailySales), 2);
}

export function grossMargin(price: unknown, cost: unknown): {
  ok: true;
  margin: Decimal;
  marginRate: Decimal;
} | { ok: false; reason: string } {
  const p = normalizeMoney(price);
  const c = normalizeMoney(cost);
  if (!p.ok) return p;
  if (!c.ok) return { ok: false, reason: 'MISSING_COST' };
  if (p.value.isZero()) return { ok: false, reason: 'ZERO_PRICE' };
  const margin = moneySub(p.value, c.value);
  return { ok: true, margin, marginRate: moneyDiv(margin, p.value) };
}

export function oversellQty(paidQty: unknown, sellableQty: unknown): Decimal {
  const paid = normalizeMoney(paidQty);
  const sellable = normalizeMoney(sellableQty);
  const p = paid.ok ? paid.value : toDecimal(0);
  const s = sellable.ok ? sellable.value : toDecimal(0);
  const diff = moneySub(p, s);
  return diff.gt(0) ? diff : toDecimal(0);
}

export function refundRemaining(paidAmount: unknown, totalRefunded: unknown): {
  ok: true;
  remaining: Decimal;
  overRefund: Decimal;
} | { ok: false; reason: string } {
  const paid = normalizeMoney(paidAmount);
  const refunded = normalizeMoney(totalRefunded);
  if (!paid.ok) return paid;
  if (!refunded.ok) return refunded;
  const remaining = moneySub(paid.value, refunded.value);
  const over = remaining.lt(0) ? remaining.abs() : toDecimal(0);
  return { ok: true, remaining: remaining.lt(0) ? toDecimal(0) : remaining, overRefund: over };
}

export function processingDays(runDate: string, start: unknown, end?: unknown): number | null {
  const startDate = normalizeDate(start);
  if (!startDate.ok) return null;
  const endDate = end ? normalizeDate(end) : { ok: true as const, value: runDate };
  if (!endDate.ok) return null;
  return daysBetween(startDate.value, endDate.value);
}

export function matchLiveSession(input: {
  liveSessionId?: unknown;
  orderTime?: unknown;
  sessions: DataRow[];
  rule: 'SESSION_ID_FIRST' | 'TIME_UNIQUE' | string;
}): { sessionId: string; status: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED'; host: string } {
  const byId = asText(input.liveSessionId);
  if (byId) {
    const hit = input.sessions.find((s) => asText(s.liveSessionId) === byId);
    if (hit) {
      return { sessionId: byId, status: 'MATCHED', host: asText(hit.host) };
    }
  }
  if (String(input.rule).toUpperCase() === 'SESSION_ID_FIRST' && byId) {
    return { sessionId: byId, status: 'UNMATCHED', host: '' };
  }
  const orderTime = normalizeDate(input.orderTime);
  if (!orderTime.ok) return { sessionId: byId, status: 'UNMATCHED', host: '' };
  const matches = input.sessions.filter((s) => {
    const start = normalizeDate(s.startTime);
    const end = normalizeDate(s.endTime);
    if (!start.ok || !end.ok) return false;
    return orderTime.value >= start.value && orderTime.value <= end.value;
  });
  if (matches.length === 1) {
    return {
      sessionId: asText(matches[0]!.liveSessionId),
      status: 'MATCHED',
      host: asText(matches[0]!.host),
    };
  }
  if (matches.length > 1) {
    return { sessionId: byId, status: 'AMBIGUOUS', host: '' };
  }
  return { sessionId: byId, status: 'UNMATCHED', host: '' };
}

export function netSales(input: {
  grossSales: unknown;
  discount?: unknown;
  refundAmount?: unknown;
}): { ok: true; value: Decimal } | { ok: false; reason: string } {
  const gross = normalizeMoney(input.grossSales);
  if (!gross.ok) return gross;
  const discount = normalizeMoney(input.discount ?? 0);
  const refund = normalizeMoney(input.refundAmount ?? 0);
  const d = discount.ok ? discount.value : toDecimal(0);
  const r = refund.ok ? refund.value : toDecimal(0);
  return { ok: true, value: moneySub(moneySub(gross.value, d), r) };
}

export function averageOrderValue(netSalesTotal: Decimal, orderCount: number): string {
  if (orderCount <= 0) return '0.00';
  return moneyToFixed(moneyDiv(netSalesTotal, orderCount));
}

export function detectDuplicateOrderLines(rows: DataRow[]): Map<string, DataRow[]> {
  const groups = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = orderLineUniqueKey(row);
    if (!asText(row.orderNo)) continue;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const dups = new Map<string, DataRow[]>();
  for (const [key, list] of groups) {
    if (list.length > 1) dups.set(key, list);
  }
  return dups;
}

export function skuNormalize(value: unknown): string {
  return asText(value).trim().toUpperCase();
}

export {
  normalizeMoney,
  financialControlTotal,
  moneyAdd,
  moneySub,
  moneyMul,
  moneyDiv,
  moneyToFixed,
  moneyRound,
  toDecimal,
  Decimal,
};

export { financialPeriod } from './financeCommon.js';
