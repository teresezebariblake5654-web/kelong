import { getUserCloudClient } from '@workstation/lib/userCloud';
import { getUserAccessToken } from '@workstation/lib/localStore';
import {
  asCreditString,
  ledgerFilterToApiType,
  mapOrder,
  mapPlan,
  mapSettings,
  mapSummary,
} from './creditDisplay';
import type {
  CreditLedgerFilter,
  CreditLedgerRow,
  CreditLedgerView,
  CreditOverview,
  RechargeOrderView,
  RechargePaymentMethod,
  RechargePlanView,
  RechargeSettingsView,
} from './userCenter.types';

function requireAuthToken() {
  if (!getUserAccessToken()) {
    const err = new Error('请先登录后再查看积分与购买') as Error & { status?: number; code?: string };
    err.status = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }
}

function client() {
  requireAuthToken();
  return getUserCloudClient();
}

export async function getCreditSummary(): Promise<CreditOverview> {
  const data = await client().getCreditSummary();
  return mapSummary(data);
}

export async function getCreditLedger(params: {
  page?: number;
  pageSize?: number;
  filter?: CreditLedgerFilter;
} = {}): Promise<CreditLedgerView> {
  const type = ledgerFilterToApiType(params.filter ?? 'all');
  const data = await client().getCreditLedger({
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 20,
    type,
  });
  const items: CreditLedgerRow[] = (data.items ?? []).map((row) => ({
    id: row.id,
    type: String(row.type),
    sourceType: row.sourceType ?? null,
    amount: asCreditString(row.amount),
    balanceBefore: asCreditString(row.balanceBefore ?? 0),
    balanceAfter: asCreditString(row.balanceAfter),
    description: row.description?.trim() || '—',
    createdAt: row.createdAt,
  }));
  return {
    items,
    page: data.pagination.page,
    pageSize: data.pagination.pageSize,
    total: data.pagination.total,
    totalPages: data.pagination.totalPages,
  };
}

export async function getRechargePlans(): Promise<RechargePlanView[]> {
  const data = await client().getRechargePlans();
  return (data ?? []).map(mapPlan);
}

export async function getRechargeSettings(): Promise<RechargeSettingsView> {
  const data = await client().getRechargeSettings();
  return mapSettings(data ?? {});
}

export async function createRechargeOrder(input: {
  planId: string;
  paymentMethod: RechargePaymentMethod;
  payerRemark?: string;
}): Promise<RechargeOrderView> {
  const data = await client().createRechargeOrder({
    planId: input.planId,
    paymentMethod: input.paymentMethod,
    payerRemark: input.payerRemark,
  });
  return mapOrder(data);
}

export async function getRechargeOrders(params: {
  page?: number;
  pageSize?: number;
} = {}): Promise<{ items: RechargeOrderView[]; page: number; pageSize: number; total: number; totalPages: number }> {
  const all = (await client().getRechargeOrders()).map(mapOrder);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 10));
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    items: all.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    totalPages,
  };
}

export async function getRechargeOrder(id: string): Promise<RechargeOrderView> {
  const data = await client().getRechargeOrder(id);
  return mapOrder(data);
}

export async function markRechargeOrderPaid(
  id: string,
  payerRemark?: string,
): Promise<RechargeOrderView> {
  const data = await client().markRechargeOrderPaid(id, {
    payerRemark: payerRemark?.trim() || undefined,
  });
  return mapOrder(data);
}

export async function cancelRechargeOrder(id: string): Promise<RechargeOrderView> {
  const data = await client().cancelRechargeOrder(id);
  return mapOrder(data);
}

export type FeedbackSubmitResult = {
  id: string;
  delivered: boolean;
};

/** Public endpoint — does not require login, but sends token when available. */
export async function submitFeedback(input: {
  category: string;
  content: string;
  contact?: string;
  emailConsent: true;
}): Promise<FeedbackSubmitResult> {
  const data = await getUserCloudClient().submitFeedback({
    category: input.category.trim(),
    content: input.content.trim(),
    contact: input.contact?.trim() || undefined,
    emailConsent: true,
  });
  return {
    id: data.id,
    delivered: data.delivered === true,
  };
}

