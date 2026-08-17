import { useCallback, useEffect, useState } from 'react';
import type { CreditOverview } from '../userCenter.types';
import { getCreditSummary } from '../userCenterApi';
import {
  CREDIT_INSUFFICIENT_HINT,
  CREDIT_LOW_BALANCE_HINT,
  CREDIT_USAGE_EXPLAINER,
} from '../creditCopy';
import { isLowBalance } from '../creditDisplay';

type OverviewSectionProps = {
  onGoRecharge: () => void;
  onGoCredits: () => void;
  onGoLogin?: () => void;
  onSummaryLoaded?: (overview: CreditOverview) => void;
};

export function OverviewSection({
  onGoRecharge,
  onGoCredits,
  onGoLogin,
  onSummaryLoaded,
}: OverviewSectionProps) {
  const [overview, setOverview] = useState<CreditOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getCreditSummary();
      setOverview(data);
      onSummaryLoaded?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [onSummaryLoaded]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="uc-panel">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3>总览</h3>
          <p className="lead">查看积分状态与快捷入口，继续回到工作站开聊。</p>
          <p className="uc-muted mt-1 text-[11px] leading-relaxed">{CREDIT_USAGE_EXPLAINER}</p>
        </div>
        <button type="button" className="uc-chip" disabled={loading} onClick={() => void load()}>
          {loading ? '刷新中' : '刷新'}
        </button>
      </div>

      {error ? (
        <div className="uc-card space-y-2 !p-3 text-[12.5px] text-[#fca5a5]">
          <p>{error}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="uc-btn-gold" onClick={() => void load()}>
              重试
            </button>
            {onGoLogin && /token|登录|UNAUTHORIZED|未登录/i.test(error) ? (
              <button type="button" className="uc-chip" onClick={onGoLogin}>
                去登录
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {overview ? (
        <>
          {isLowBalance(overview.balance, overview.lowBalance) ? (
            <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-100">
              {Number(overview.balance) <= 0
                ? CREDIT_INSUFFICIENT_HINT
                : CREDIT_LOW_BALANCE_HINT}
            </div>
          ) : null}
          <div className="uc-stat-grid">
            <div className="uc-stat">
              <div className="uc-stat__label">当前积分</div>
              <div className="uc-stat__value">{overview.balance}</div>
            </div>
            <div className="uc-stat">
              <div className="uc-stat__label">本月消耗积分</div>
              <div className="uc-stat__value">{overview.monthlyConsumed}</div>
            </div>
            <div className="uc-stat">
              <div className="uc-stat__label">累计获得积分</div>
              <div className="uc-stat__value">{overview.totalRecharged}</div>
            </div>
            <div className="uc-stat">
              <div className="uc-stat__label">累计消耗积分</div>
              <div className="uc-stat__value">{overview.totalConsumed}</div>
            </div>
          </div>
        </>
      ) : loading ? (
        <p className="uc-muted">正在加载积分…</p>
      ) : null}

      <div className="flex gap-2">
        <button type="button" className="uc-btn-gold flex-1" onClick={onGoRecharge}>
          购买积分
        </button>
        <button
          type="button"
          className="flex-1 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-[12.5px] font-semibold text-white/80"
          onClick={onGoCredits}
        >
          积分明细
        </button>
      </div>
    </div>
  );
}
