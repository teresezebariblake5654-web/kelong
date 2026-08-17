import type {
  CreditLedgerFilter,
  CreditLedgerRow,
  CreditOverview,
  RechargeOrderStatus,
  RechargeOrderView,
  RechargePaymentMethod,
  RechargePlanView,
  RechargeSettingsView,
} from './userCenter.types';
import {
  CREDIT_DISPLAY_NAME_SPACED,
  formatCreditNumber,
  withCreditUnit,
} from './creditCopy';

/** Convert API numeric/decimal values to display strings without float math on balances. */
export function asCreditString(value: unknown): string {
  if (value == null) return '0';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : '0';
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '0';
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === 'object' && value !== null && 'toString' in value) {
    return String((value as { toString: () => string }).toString());
  }
  return '0';
}

/** UI-only: priceCents / 100 → yuan display. Not used for ledger math. */
export function formatPriceYuan(priceCents: number): string {
  const cents = Number.isFinite(priceCents) ? Math.trunc(priceCents) : 0;
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const rem = abs % 100;
  const body = rem === 0 ? String(yuan) : `${yuan}.${String(rem).padStart(2, '0')}`;
  return neg ? `-${body}` : body;
}

export function ledgerTypeLabel(type: string, sourceType?: string | null): string {
  const src = (sourceType ?? '').toUpperCase();
  const t = (type ?? '').toUpperCase();
  if (t === 'RECHARGE' || src === 'RECHARGE_ORDER') return '购买积分到账';
  if (t === 'CONSUME' || src === 'AI_CONSUME' || t === 'AI_CONSUME') return 'AI 功能使用';
  if (t === 'ADMIN_ADJUST') return '管理员调整';
  if (t === 'REFUND') return '积分退回';
  if (src === 'BONUS' || t === 'BONUS' || t === 'INITIAL') return '赠送积分';
  return type || '其他';
}

export function isCreditDebit(type: string, sourceType?: string | null): boolean {
  const t = (type ?? '').toUpperCase();
  const src = (sourceType ?? '').toUpperCase();
  if (t === 'CONSUME' || src === 'AI_CONSUME' || t === 'AI_CONSUME') return true;
  return false;
}

export function formatLedgerSignedAmount(
  row: Pick<CreditLedgerRow, 'type' | 'sourceType' | 'amount'>,
): string {
  const raw = asCreditString(row.amount);
  let signed: string;
  if (raw.startsWith('+') || raw.startsWith('-')) {
    signed = raw;
  } else if (isCreditDebit(row.type, row.sourceType)) {
    signed = raw === '0' ? '0' : `-${raw.replace(/^-/, '')}`;
  } else {
    signed = raw.startsWith('-') ? raw : `+${raw}`;
  }
  const sign = signed.startsWith('-') ? '-' : signed.startsWith('+') ? '+' : '';
  const num = signed.replace(/^[+-]/, '');
  return `${sign}${formatCreditNumber(num)} ${CREDIT_DISPLAY_NAME_SPACED}`;
}

export function formatLedgerBalanceAfter(balanceAfter: string | number): string {
  return `变动后：${withCreditUnit(asCreditString(balanceAfter))}`;
}

export function orderStatusLabel(status: RechargeOrderStatus): string {
  switch (status) {
    case 'PENDING_PAYMENT':
      return '等待付款';
    case 'PENDING_REVIEW':
      return '处理中';
    case 'PAID':
      return '积分到账';
    case 'REJECTED':
      return '审核未通过';
    case 'CANCELLED':
      return '已取消';
    default:
      return String(status);
  }
}

export function paymentMethodLabel(method: string): string {
  const m = method.toLowerCase();
  if (m === 'wechat') return '微信支付';
  if (m === 'alipay') return '支付宝支付';
  return method || '人工转账';
}

export function canMarkPaid(status: RechargeOrderStatus): boolean {
  return status === 'PENDING_PAYMENT';
}

export function canCancelOrder(status: RechargeOrderStatus): boolean {
  return status === 'PENDING_PAYMENT';
}

export function isLowBalance(balance: string, lowBalanceFlag?: boolean): boolean {
  if (lowBalanceFlag === true) return true;
  const n = Number(balance);
  return Number.isFinite(n) && n <= 0;
}

export function ledgerFilterToApiType(filter: CreditLedgerFilter): string | undefined {
  if (filter === 'recharge') return 'RECHARGE';
  if (filter === 'ai_consume') return 'AI_CONSUME';
  return undefined;
}

export function mapPlan(raw: {
  id: string;
  name: string;
  priceCents: number;
  creditAmount: number | string;
  description?: string | null;
}): RechargePlanView {
  return {
    id: raw.id,
    name: raw.name,
    priceCents: raw.priceCents,
    priceYuan: formatPriceYuan(raw.priceCents),
    creditAmount: asCreditString(raw.creditAmount),
    description: raw.description?.trim() || '',
  };
}

export function mapOrder(raw: {
  id: string;
  orderNo: string;
  planNameSnapshot: string;
  amountCents: number;
  creditAmount: number | string;
  paymentMethod: string;
  status: string;
  payerRemark?: string | null;
  adminRemark?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  userSubmittedAt?: string | null;
}): RechargeOrderView {
  return {
    id: raw.id,
    orderNo: raw.orderNo,
    planName: raw.planNameSnapshot,
    amountCents: raw.amountCents,
    priceYuan: formatPriceYuan(raw.amountCents),
    creditAmount: asCreditString(raw.creditAmount),
    paymentMethod: raw.paymentMethod,
    status: raw.status,
    payerRemark: raw.payerRemark ?? null,
    adminRemark: raw.adminRemark ?? null,
    createdAt: raw.createdAt,
    reviewedAt: raw.reviewedAt ?? null,
    userSubmittedAt: raw.userSubmittedAt ?? null,
  };
}

export function mapSummary(raw: {
  balance: number | string;
  monthlyConsumed?: number | string;
  totalRecharged: number | string;
  totalConsumed: number | string;
  lowBalance?: boolean;
  updatedAt?: string;
}): CreditOverview {
  return {
    balance: asCreditString(raw.balance),
    monthlyConsumed: asCreditString(raw.monthlyConsumed ?? 0),
    totalRecharged: asCreditString(raw.totalRecharged),
    totalConsumed: asCreditString(raw.totalConsumed),
    lowBalance: raw.lowBalance === true,
    updatedAt: raw.updatedAt,
  };
}

export function mapSettings(raw: {
  wechatQrUrl?: string | null;
  alipayQrUrl?: string | null;
  wechatQrByAmount?: Record<string, string> | null;
  alipayQrByAmount?: Record<string, string> | null;
  payeeName?: string | null;
  supportText?: string | null;
  notice?: string | null;
}): RechargeSettingsView {
  return {
    wechatQrUrl: raw.wechatQrUrl ?? null,
    alipayQrUrl: raw.alipayQrUrl ?? null,
    wechatQrByAmount: raw.wechatQrByAmount ?? {},
    alipayQrByAmount: raw.alipayQrByAmount ?? {},
    payeeName: raw.payeeName ?? null,
    supportText: raw.supportText ?? null,
    notice: raw.notice ?? null,
  };
}

export function qrUrlForMethod(
  settings: RechargeSettingsView,
  method: RechargePaymentMethod,
  amountCents?: number | null,
): string | null {
  const byAmount = method === 'wechat' ? settings.wechatQrByAmount : settings.alipayQrByAmount;
  if (amountCents != null && Number.isFinite(amountCents)) {
    const yuan = String(Math.round(amountCents / 100));
    const keyed = byAmount?.[yuan];
    if (keyed) return keyed;
  }
  return method === 'wechat' ? settings.wechatQrUrl : settings.alipayQrUrl;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function notifyCreditsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('workstation:credits-changed'));
}
