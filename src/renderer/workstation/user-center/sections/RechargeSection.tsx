import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CreditOverview,
  RechargeOrderView,
  RechargePaymentMethod,
  RechargePlanView,
  RechargeSettingsView,
} from '../userCenter.types';
import {
  cancelRechargeOrder,
  createRechargeOrder,
  getCreditSummary,
  getRechargeOrder,
  getRechargeOrders,
  getRechargePlans,
  getRechargeSettings,
  markRechargeOrderPaid,
} from '../userCenterApi';
import {
  CREDIT_USAGE_EXPLAINER,
  formatCreditNumber,
} from '../creditCopy';
import {
  canCancelOrder,
  canMarkPaid,
  formatDateTime,
  isLowBalance,
  orderStatusLabel,
  paymentMethodLabel,
  qrUrlForMethod,
} from '../creditDisplay';

type RechargeSectionProps = {
  onSummaryLoaded?: (overview: CreditOverview) => void;
  onGoLogin?: () => void;
};

type PanelMode = 'plans' | 'pay' | 'detail';

function looksLikeAuthError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('token') ||
    lower.includes('unauthorized') ||
    message.includes('登录') ||
    message.includes('未登录')
  );
}

/** Domestic-style recharge: pick plan, show QR, create order, mark paid. */
export function RechargeSection({ onSummaryLoaded, onGoLogin }: RechargeSectionProps) {
  const [overview, setOverview] = useState<CreditOverview | null>(null);
  const [plans, setPlans] = useState<RechargePlanView[]>([]);
  const [settings, setSettings] = useState<RechargeSettingsView | null>(null);
  const [orders, setOrders] = useState<RechargeOrderView[]>([]);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersTotalPages, setOrdersTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [mode, setMode] = useState<PanelMode>('plans');
  const [selectedPlan, setSelectedPlan] = useState<RechargePlanView | null>(null);
  const [channel, setChannel] = useState<RechargePaymentMethod>('wechat');
  const [activeOrder, setActiveOrder] = useState<RechargeOrderView | null>(null);
  const [creating, setCreating] = useState(false);
  const [marking, setMarking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const createLock = useRef(false);
  const markLock = useRef(false);

  const refreshSummary = useCallback(async () => {
    const data = await getCreditSummary();
    setOverview(data);
    onSummaryLoaded?.(data);
    return data;
  }, [onSummaryLoaded]);

  const refreshOrders = useCallback(
    async (page = ordersPage) => {
      const data = await getRechargeOrders({ page, pageSize: 8 });
      setOrders(data.items);
      setOrdersPage(data.page);
      setOrdersTotalPages(data.totalPages);
      return data;
    },
    [ordersPage],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [summary, planList, setting, orderPage] = await Promise.all([
        getCreditSummary(),
        getRechargePlans(),
        getRechargeSettings(),
        getRechargeOrders({ page: 1, pageSize: 8 }),
      ]);
      setOverview(summary);
      onSummaryLoaded?.(summary);
      setPlans(planList);
      setSettings(setting);
      setOrders(orderPage.items);
      setOrdersPage(orderPage.page);
      setOrdersTotalPages(orderPage.totalPages);
      if (setting.wechatQrUrl) setChannel('wechat');
      else if (setting.alipayQrUrl) setChannel('alipay');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [onSummaryLoaded]);

  useEffect(() => {
    void load();
  }, [load]);

  const startPay = async (plan: RechargePlanView, method: RechargePaymentMethod = channel) => {
    if (creating || createLock.current) return;
    createLock.current = true;
    setCreating(true);
    setSelectedPlan(plan);
    setActiveOrder(null);
    setMessage('');
    setMode('pay');
    setChannel(method);
    try {
      const order = await createRechargeOrder({
        planId: plan.id,
        paymentMethod: method,
      });
      setActiveOrder(order);
      setMessage('请使用手机扫码付款，付完后点下方「我已付款」。');
      await refreshOrders(1);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '创建订单失败');
    } finally {
      setCreating(false);
      createLock.current = false;
    }
  };

  const onMarkPaid = async () => {
    if (!activeOrder || !canMarkPaid(activeOrder.status) || marking || markLock.current) return;
    markLock.current = true;
    setMarking(true);
    setMessage('');
    try {
      const updated = await markRechargeOrderPaid(activeOrder.id);
      setActiveOrder(updated);
      setMessage(
        updated.status === 'PAID'
          ? `积分已到账：${formatCreditNumber(updated.creditAmount)} AI 积分`
          : '已提交，请稍后刷新查看积分。',
      );
      await Promise.all([refreshOrders(1), refreshSummary()]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '提交失败');
    } finally {
      setMarking(false);
      markLock.current = false;
    }
  };

  const onCancel = async () => {
    if (!activeOrder || !canCancelOrder(activeOrder.status) || cancelling) return;
    setCancelling(true);
    setMessage('');
    try {
      const updated = await cancelRechargeOrder(activeOrder.id);
      setActiveOrder(updated);
      setMessage('订单已取消。');
      await refreshOrders(1);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '取消失败');
    } finally {
      setCancelling(false);
    }
  };

  const openOrderDetail = async (orderId: string) => {
    setMessage('');
    try {
      const order = await getRechargeOrder(orderId);
      setActiveOrder(order);
      setSelectedPlan(null);
      setChannel(order.paymentMethod === 'alipay' ? 'alipay' : 'wechat');
      setMode('detail');
      if (order.status === 'PAID') {
        await refreshSummary();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载订单失败');
    }
  };

  const copyOrderNo = async (orderNo: string) => {
    try {
      await navigator.clipboard.writeText(orderNo);
      setMessage('订单号已复制，付款时可备注到账更快');
    } catch {
      setMessage(`请手动复制订单号：${orderNo}`);
    }
  };

  const displayOrder = activeOrder;
  const amountCents = displayOrder?.amountCents ?? selectedPlan?.priceCents ?? null;
  const qrUrl = settings ? qrUrlForMethod(settings, channel, amountCents) : null;
  const displayPlanName = displayOrder?.planName ?? selectedPlan?.name ?? '-';
  const displayPrice = displayOrder?.priceYuan ?? selectedPlan?.priceYuan ?? '-';
  const displayCredits = displayOrder?.creditAmount ?? selectedPlan?.creditAmount ?? '-';
  const payReady = Boolean(displayOrder && canMarkPaid(displayOrder.status));
  const showPayPanel = mode === 'pay' || mode === 'detail';

  return (
    <div className="uc-panel">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3>购买积分</h3>
          <p className="lead">
            {overview
              ? `当前积分 ${overview.balance} · 选套餐扫码即付`
              : '选择套餐后直接扫码付款'}
          </p>
          <p className="uc-muted mt-1 text-[11px] leading-relaxed">{CREDIT_USAGE_EXPLAINER}</p>
        </div>
        <button type="button" className="uc-chip" disabled={loading} onClick={() => void load()}>
          {loading ? '刷新中' : '刷新'}
        </button>
      </div>

      {overview && isLowBalance(overview.balance, overview.lowBalance) ? (
        <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-100">
          AI 积分不足，请选择套餐扫码充值。
        </div>
      ) : null}

      {error ? (
        <div className="uc-card space-y-2 p-3 text-[12.5px] text-[#fca5a5]">
          <p>{error}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="uc-btn-gold" onClick={() => void load()}>
              重试
            </button>
            {onGoLogin && looksLikeAuthError(error) ? (
              <button type="button" className="uc-chip" onClick={onGoLogin}>
                去登录
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!showPayPanel ? (
        <div>
          <div className="mb-2 text-[11px] text-white/45">积分套餐 · 点选即出收款码</div>
          {!plans.length && !loading ? (
            <p className="uc-muted">暂无可用套餐，请稍后再试或联系运营。</p>
          ) : (
            <div className="space-y-2">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  className="uc-card w-full p-3 text-left transition hover:bg-white/8"
                  disabled={creating}
                  onClick={() => void startPay(plan)}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-semibold">{plan.name}</span>
                    <span className="text-[14px] font-semibold text-[#e0c88a]">
                      ¥{plan.priceYuan}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-white/70">
                    ¥{plan.priceYuan}：{formatCreditNumber(plan.creditAmount)} AI 积分
                  </div>
                  {plan.description ? (
                    <div className="uc-muted mt-1">{plan.description}</div>
                  ) : null}
                  <div className="mt-2 text-[11px] text-[#e0c88a]">点选后扫码付款</div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="uc-card space-y-3 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12.5px] font-semibold">
              {creating ? '正在生成订单...' : '扫码付款'}
            </div>
            <button
              type="button"
              className="uc-chip"
              onClick={() => {
                setMode('plans');
                setActiveOrder(null);
                setSelectedPlan(null);
                setMessage('');
              }}
            >
              返回套餐
            </button>
          </div>

          <div className="rounded-xl bg-white/5 px-3 py-2 text-center">
            <div className="text-[11px] text-white/45">{displayPlanName}</div>
            <div className="mt-1 text-[22px] font-semibold tracking-tight text-[#e0c88a]">
              ¥{displayPrice}
            </div>
            <div className="mt-0.5 text-[12px] text-white/70">
              到账 {formatCreditNumber(displayCredits)} AI 积分
            </div>
          </div>

          <div className="uc-chip-row justify-center">
            <button
              type="button"
              className={`uc-chip ${channel === 'wechat' ? 'uc-chip--on' : ''}`}
              onClick={() => setChannel('wechat')}
            >
              微信
            </button>
            <button
              type="button"
              className={`uc-chip ${channel === 'alipay' ? 'uc-chip--on' : ''}`}
              onClick={() => setChannel('alipay')}
            >
              支付宝
            </button>
          </div>

          <div className="uc-qr-slot py-4">
            {creating ? (
              <span>订单生成中...</span>
            ) : qrUrl ? (
              <img
                src={qrUrl}
                alt={channel === 'wechat' ? '微信收款码' : '支付宝收款码'}
                className="mx-auto max-h-52 rounded-xl bg-white p-3"
              />
            ) : (
              <span>收款码暂未配置，请联系客服</span>
            )}
          </div>

          <p className="text-center text-[12px] leading-relaxed text-white/75">
            打开{channel === 'wechat' ? '微信' : '支付宝'}扫一扫完成付款
            {displayOrder ? '，备注订单号更易核对' : ''}
          </p>

          {displayOrder ? (
            <div className="flex flex-wrap items-center justify-center gap-2 text-[12px]">
              <span className="text-white/55">订单号 {displayOrder.orderNo}</span>
              <button
                type="button"
                className="uc-chip"
                onClick={() => void copyOrderNo(displayOrder.orderNo)}
              >
                复制
              </button>
              <span className="text-white/45">{orderStatusLabel(displayOrder.status)}</span>
            </div>
          ) : null}

          {settings?.payeeName ? (
            <p className="text-center text-[11px] text-white/45">收款方：{settings.payeeName}</p>
          ) : null}
          {settings?.notice ? <p className="uc-muted text-center">{settings.notice}</p> : null}
          {settings?.supportText ? (
            <p className="uc-muted text-center">{settings.supportText}</p>
          ) : null}

          <div className="flex flex-col gap-2">
            {displayOrder?.status === 'PENDING_REVIEW' ? (
              <p className="text-center text-[12.5px] text-[#e0c88a]">处理中，请稍后刷新</p>
            ) : null}
            {displayOrder?.status === 'REJECTED' && displayOrder.adminRemark ? (
              <p className="text-[12px] text-[#fca5a5]">未通过：{displayOrder.adminRemark}</p>
            ) : null}
            {displayOrder?.status === 'PAID' ? (
              <p className="text-center text-[12.5px] text-[#e0c88a]">
                积分已到账 · {formatCreditNumber(displayOrder.creditAmount)} AI 积分
              </p>
            ) : null}
            {payReady ? (
              <button
                type="button"
                className="uc-btn-gold"
                disabled={marking || creating}
                onClick={() => void onMarkPaid()}
              >
                {marking ? '提交中...' : `我已付款 ¥${displayPrice}`}
              </button>
            ) : null}
            {!displayOrder && !creating ? (
              <button
                type="button"
                className="uc-btn-gold"
                disabled={!selectedPlan}
                onClick={() => selectedPlan && void startPay(selectedPlan, channel)}
              >
                重新生成订单
              </button>
            ) : null}
            {displayOrder && canCancelOrder(displayOrder.status) ? (
              <button
                type="button"
                className="rounded-full border border-white/15 bg-white/5 px-3 py-2 text-[12.5px] font-semibold text-white/80"
                disabled={cancelling}
                onClick={() => void onCancel()}
              >
                {cancelling ? '取消中...' : '取消订单'}
              </button>
            ) : null}
          </div>
        </div>
      )}

      <div className="uc-card p-2">
        <div className="flex items-center justify-between px-2 pb-1 pt-1">
          <div className="text-[11px] font-medium text-white/45">购买记录</div>
          <button type="button" className="uc-chip" onClick={() => void refreshOrders(ordersPage)}>
            刷新
          </button>
        </div>
        {!orders.length && !loading ? (
          <p className="uc-muted px-2 py-4 text-center">暂无购买订单</p>
        ) : null}
        {orders.map((order) => (
          <button
            key={order.id}
            type="button"
            className="uc-list-row w-full text-left"
            onClick={() => void openOrderDetail(order.id)}
          >
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-medium">
                {order.planName} · ¥{order.priceYuan}
              </div>
              <div className="uc-muted mt-0.5">
                {order.orderNo} · {paymentMethodLabel(order.paymentMethod)}
              </div>
              <div className="uc-muted mt-0.5">
                {formatDateTime(order.createdAt)}
                {order.reviewedAt ? ` · 确认 ${formatDateTime(order.reviewedAt)}` : ''}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[12px] font-medium text-[#e0c88a]">
                {orderStatusLabel(order.status)}
              </div>
              <div className="uc-muted mt-0.5">积分 {order.creditAmount}</div>
            </div>
          </button>
        ))}
        {ordersTotalPages > 1 ? (
          <div className="flex items-center justify-between gap-2 px-2 py-2">
            <button
              type="button"
              className="uc-chip"
              disabled={ordersPage <= 1}
              onClick={() => void refreshOrders(ordersPage - 1)}
            >
              上一页
            </button>
            <span className="uc-muted">
              {ordersPage} / {ordersTotalPages}
            </span>
            <button
              type="button"
              className="uc-chip"
              disabled={ordersPage >= ordersTotalPages}
              onClick={() => void refreshOrders(ordersPage + 1)}
            >
              下一页
            </button>
          </div>
        ) : null}
      </div>

      {message ? <p className="text-center text-[12px] text-[#e0c88a]">{message}</p> : null}
    </div>
  );
}
