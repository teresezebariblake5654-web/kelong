import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  asCreditString,
  canCancelOrder,
  canMarkPaid,
  formatLedgerSignedAmount,
  formatPriceYuan,
  isLowBalance,
  ledgerTypeLabel,
  mapOrder,
  mapPlan,
  mapSummary,
  orderStatusLabel,
  qrUrlForMethod,
} from './creditDisplay';

describe('Phase 7 creditDisplay helpers', () => {
  it('keeps credit fields as strings without float corruption', () => {
    expect(asCreditString('9007199254740993')).toBe('9007199254740993');
    expect(asCreditString('12345678901234567890')).toBe('12345678901234567890');
    expect(mapSummary({
      balance: '9007199254740993',
      monthlyConsumed: '1',
      totalRecharged: '2',
      totalConsumed: '3',
    }).balance).toBe('9007199254740993');
  });

  it('formats priceCents to yuan for UI only', () => {
    expect(formatPriceYuan(19900)).toBe('199');
    expect(formatPriceYuan(19950)).toBe('199.50');
  });

  it('maps plans from backend without hardcoded catalog', () => {
    const plan = mapPlan({
      id: 'p1',
      name: '基础包',
      priceCents: 9900,
      creditAmount: '5000',
      description: '适合试用',
    });
    expect(plan.priceYuan).toBe('99');
    expect(plan.creditAmount).toBe('5000');
    expect(plan.name).toBe('基础包');
  });

  it('labels ledger types including AI_CONSUME via sourceType', () => {
    expect(ledgerTypeLabel('RECHARGE')).toBe('购买积分到账');
    expect(ledgerTypeLabel('CONSUME', 'AI_CONSUME')).toBe('AI 功能使用');
    expect(ledgerTypeLabel('ADMIN_ADJUST')).toBe('管理员调整');
    expect(ledgerTypeLabel('INITIAL', 'BONUS')).toBe('赠送积分');
    expect(formatLedgerSignedAmount({ type: 'CONSUME', sourceType: 'AI_CONSUME', amount: '12' })).toBe(
      '-12 AI 积分',
    );
    expect(formatLedgerSignedAmount({ type: 'RECHARGE', sourceType: null, amount: '100' })).toBe(
      '+100 AI 积分',
    );
  });

  it('user-facing copy no longer uses legacy 额度 terms in helpers', async () => {
    const { CREDIT_USAGE_EXPLAINER, appendAiPointsCostLine } = await import('./creditCopy');
    expect(CREDIT_USAGE_EXPLAINER).toMatch(/AI 积分/);
    expect(CREDIT_USAGE_EXPLAINER).not.toMatch(/剩余额度|充值额度/);
    expect(appendAiPointsCostLine('分析完成', 120)).toBe('分析完成\n\n本次消耗：120 AI 积分');
    expect(appendAiPointsCostLine('分析完成\n\n本次消耗：120 AI 积分', 120)).toBe(
      '分析完成\n\n本次消耗：120 AI 积分',
    );
  });

  it('enforces mark-paid / cancel only for PENDING_PAYMENT', () => {
    expect(canMarkPaid('PENDING_PAYMENT')).toBe(true);
    expect(canMarkPaid('PENDING_REVIEW')).toBe(false);
    expect(canCancelOrder('PENDING_REVIEW')).toBe(false);
    expect(orderStatusLabel('PENDING_REVIEW')).toBe('处理中');
    expect(orderStatusLabel('PAID')).toBe('积分到账');
  });

  it('does not crash when QR urls are null', () => {
    const settings = {
      wechatQrUrl: null,
      alipayQrUrl: null,
      wechatQrByAmount: {},
      alipayQrByAmount: {},
      payeeName: null,
      supportText: null,
      notice: null,
    };
    expect(qrUrlForMethod(settings, 'wechat')).toBeNull();
    expect(qrUrlForMethod(settings, 'alipay')).toBeNull();
    expect(isLowBalance('0')).toBe(true);
  });

  it('picks Alipay QR by plan amount', () => {
    const settings = {
      wechatQrUrl: null,
      alipayQrUrl: 'http://x/fallback.png',
      wechatQrByAmount: {},
      alipayQrByAmount: {
        '50': 'http://x/50.png',
        '100': 'http://x/100.png',
        '500': 'http://x/500.png',
      },
      payeeName: null,
      supportText: null,
      notice: null,
    };
    expect(qrUrlForMethod(settings, 'alipay', 5_000)).toBe('http://x/50.png');
    expect(qrUrlForMethod(settings, 'alipay', 10_000)).toBe('http://x/100.png');
    expect(qrUrlForMethod(settings, 'alipay', 50_000)).toBe('http://x/500.png');
    expect(qrUrlForMethod(settings, 'alipay')).toBe('http://x/fallback.png');
  });

  it('picks WeChat QR by plan amount', () => {
    const settings = {
      wechatQrUrl: 'http://x/wx-fallback.png',
      alipayQrUrl: null,
      wechatQrByAmount: {
        '50': 'http://x/wx-50.png',
        '100': 'http://x/wx-100.png',
        '500': 'http://x/wx-500.png',
      },
      alipayQrByAmount: {},
      payeeName: null,
      supportText: null,
      notice: null,
    };
    expect(qrUrlForMethod(settings, 'wechat', 5_000)).toBe('http://x/wx-50.png');
    expect(qrUrlForMethod(settings, 'wechat', 10_000)).toBe('http://x/wx-100.png');
    expect(qrUrlForMethod(settings, 'wechat', 50_000)).toBe('http://x/wx-500.png');
    expect(qrUrlForMethod(settings, 'wechat')).toBe('http://x/wx-fallback.png');
  });

  it('maps orders with admin remark for REJECTED', () => {
    const order = mapOrder({
      id: 'o1',
      orderNo: 'RC1',
      planNameSnapshot: 'Pro',
      amountCents: 10000,
      creditAmount: 1000,
      paymentMethod: 'wechat',
      status: 'REJECTED',
      adminRemark: '金额不符',
      createdAt: '2026-07-30T00:00:00.000Z',
      reviewedAt: '2026-07-30T01:00:00.000Z',
    });
    expect(order.adminRemark).toBe('金额不符');
    expect(order.priceYuan).toBe('100');
  });
});

const mockClient = {
  getCreditSummary: vi.fn(),
  getCreditLedger: vi.fn(),
  getRechargePlans: vi.fn(),
  getRechargeSettings: vi.fn(),
  createRechargeOrder: vi.fn(),
  getRechargeOrders: vi.fn(),
  getRechargeOrder: vi.fn(),
  markRechargeOrderPaid: vi.fn(),
  cancelRechargeOrder: vi.fn(),
};

vi.mock('@workstation/lib/userCloud', () => ({
  getUserCloudClient: () => mockClient,
}));

vi.mock('@workstation/lib/localStore', () => ({
  getUserAccessToken: () => 'test-token',
  getActiveOrganizationId: () => 'org-1',
  loadSettings: () => ({ apiBaseUrl: 'http://localhost:3001' }),
}));

describe('Phase 7 userCenterApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getCreditSummary returns string fields from backend', async () => {
    mockClient.getCreditSummary.mockResolvedValue({
      organizationId: 'org-1',
      balance: 120,
      frozenBalance: 0,
      availableBalance: 120,
      monthlyConsumed: 30,
      totalRecharged: 500,
      totalConsumed: 380,
      unit: 'credits',
      updatedAt: '2026-07-30T00:00:00.000Z',
    });
    const { getCreditSummary } = await import('./userCenterApi');
    const summary = await getCreditSummary();
    expect(summary.balance).toBe('120');
    expect(summary.monthlyConsumed).toBe('30');
    expect(typeof summary.balance).toBe('string');
  });

  it('createRechargeOrder posts planId + paymentMethod once', async () => {
    mockClient.createRechargeOrder.mockResolvedValue({
      id: 'ord-1',
      orderNo: 'RC123',
      userId: 'u1',
      planId: 'plan-1',
      planNameSnapshot: '基础包',
      amountCents: 9900,
      creditAmount: 5000,
      paymentMethod: 'wechat',
      status: 'PENDING_PAYMENT',
      payerRemark: null,
      adminRemark: null,
      userSubmittedAt: null,
      reviewedAt: null,
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
    });
    const { createRechargeOrder } = await import('./userCenterApi');
    const order = await createRechargeOrder({ planId: 'plan-1', paymentMethod: 'wechat' });
    expect(mockClient.createRechargeOrder).toHaveBeenCalledTimes(1);
    expect(mockClient.createRechargeOrder).toHaveBeenCalledWith({
      planId: 'plan-1',
      paymentMethod: 'wechat',
      payerRemark: undefined,
    });
    expect(order.orderNo).toBe('RC123');
    expect(order.priceYuan).toBe('99');
  });

  it('markRechargeOrderPaid calls mark-paid endpoint', async () => {
    mockClient.markRechargeOrderPaid.mockResolvedValue({
      id: 'ord-1',
      orderNo: 'RC123',
      userId: 'u1',
      planId: 'plan-1',
      planNameSnapshot: '基础包',
      amountCents: 9900,
      creditAmount: 5000,
      paymentMethod: 'wechat',
      status: 'PAID',
      payerRemark: '已转',
      adminRemark: 'auto_on_mark_paid',
      userSubmittedAt: '2026-07-30T00:10:00.000Z',
      reviewedAt: '2026-07-30T00:10:00.000Z',
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:10:00.000Z',
    });
    const { markRechargeOrderPaid } = await import('./userCenterApi');
    const order = await markRechargeOrderPaid('ord-1', '已转');
    expect(mockClient.markRechargeOrderPaid).toHaveBeenCalledWith('ord-1', {
      payerRemark: '已转',
    });
    expect(order.status).toBe('PAID');
    expect(canMarkPaid(order.status)).toBe(false);
  });

  it('getRechargeSettings tolerates null QR urls', async () => {
    mockClient.getRechargeSettings.mockResolvedValue({
      wechatQrUrl: null,
      alipayQrUrl: null,
      wechatQrByAmount: {},
      alipayQrByAmount: {},
      payeeName: null,
      supportText: null,
      notice: null,
    });
    const { getRechargeSettings } = await import('./userCenterApi');
    const settings = await getRechargeSettings();
    expect(settings.wechatQrUrl).toBeNull();
    expect(qrUrlForMethod(settings, 'alipay')).toBeNull();
  });

  it('getRechargePlans comes from API list (not hardcoded)', async () => {
    mockClient.getRechargePlans.mockResolvedValue([
      { id: 'a', name: 'A', priceCents: 100, creditAmount: 10, description: null },
      { id: 'b', name: 'B', priceCents: 200, creditAmount: 25, description: 'x' },
    ]);
    const { getRechargePlans } = await import('./userCenterApi');
    const plans = await getRechargePlans();
    expect(plans).toHaveLength(2);
    expect(plans.map((p) => p.id)).toEqual(['a', 'b']);
    expect(mockClient.getRechargePlans).toHaveBeenCalled();
  });

  it('getRechargeOrders only returns mapped API rows (own orders from backend)', async () => {
    mockClient.getRechargeOrders.mockResolvedValue([
      {
        id: 'ord-1',
        orderNo: 'RC1',
        userId: 'u1',
        planId: 'p1',
        planNameSnapshot: 'A',
        amountCents: 100,
        creditAmount: 10,
        paymentMethod: 'alipay',
        status: 'PAID',
        payerRemark: null,
        adminRemark: null,
        userSubmittedAt: null,
        reviewedAt: '2026-07-30T01:00:00.000Z',
        createdAt: '2026-07-30T00:00:00.000Z',
        updatedAt: '2026-07-30T01:00:00.000Z',
      },
    ]);
    const { getRechargeOrders } = await import('./userCenterApi');
    const page = await getRechargeOrders({ page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.paymentMethod).toBe('alipay');
  });
});
