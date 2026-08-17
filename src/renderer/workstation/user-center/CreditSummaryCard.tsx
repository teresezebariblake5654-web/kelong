import { Zap } from 'lucide-react';
import type { CreditOverview } from './userCenter.types';
import { CREDIT_INSUFFICIENT_HINT, CREDIT_LOW_BALANCE_HINT } from './creditCopy';
import { isLowBalance } from './creditDisplay';

type CreditSummaryCardProps = {
  overview: CreditOverview | null;
  loading?: boolean;
  onDetails: () => void;
  onRecharge: () => void;
};

export function CreditSummaryCard({
  overview,
  loading,
  onDetails,
  onRecharge,
}: CreditSummaryCardProps) {
  const balance = overview?.balance ?? '—';
  const monthly = overview?.monthlyConsumed ?? '—';
  const low = overview ? isLowBalance(overview.balance, overview.lowBalance) : false;
  const balanceNum = overview ? Number(overview.balance) : NaN;
  const lowMessage =
    Number.isFinite(balanceNum) && balanceNum <= 0
      ? CREDIT_INSUFFICIENT_HINT
      : CREDIT_LOW_BALANCE_HINT;

  return (
    <div className="uc-card mt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-white/85">积分概览</span>
        <button
          type="button"
          onClick={onDetails}
          className="text-[11px] text-white/45 transition hover:text-white/80"
        >
          详情 ›
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-white/45">当前积分</div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-[22px] font-semibold tabular-nums tracking-tight">{balance}</span>
            <span className="text-[11px] text-[#e0c88a]">●</span>
          </div>
          <div className="mt-1 text-[11px] text-white/45">
            本月消耗积分{' '}
            <span className="font-medium text-white/75">{monthly}</span>
          </div>
          {low ? (
            <div className="mt-1 text-[11px] text-rose-200">{lowMessage}</div>
          ) : null}
          {loading ? <div className="uc-muted mt-1">刷新中…</div> : null}
        </div>
      </div>

      <button type="button" className="uc-btn-gold mt-3" onClick={onRecharge}>
        <Zap className="size-3.5" />
        购买积分
      </button>
    </div>
  );
}
