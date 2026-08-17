import { useCallback, useEffect, useState } from 'react';
import type { CreditLedgerFilter, CreditLedgerView, CreditOverview } from '../userCenter.types';
import { getCreditLedger, getCreditSummary } from '../userCenterApi';
import {
  CREDIT_LOW_BALANCE_HINT,
  CREDIT_USAGE_EXPLAINER,
} from '../creditCopy';
import {
  formatDateTime,
  formatLedgerBalanceAfter,
  formatLedgerSignedAmount,
  isLowBalance,
  ledgerTypeLabel,
} from '../creditDisplay';

type CreditsSectionProps = {
  onSummaryLoaded?: (overview: CreditOverview) => void;
  onGoLogin?: () => void;
};

export function CreditsSection({ onSummaryLoaded, onGoLogin }: CreditsSectionProps) {
  const [overview, setOverview] = useState<CreditOverview | null>(null);
  const [ledger, setLedger] = useState<CreditLedgerView | null>(null);
  const [filter, setFilter] = useState<CreditLedgerFilter>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [summary, ledgerPage] = await Promise.all([
        getCreditSummary(),
        getCreditLedger({ page, pageSize: 10, filter }),
      ]);
      setOverview(summary);
      setLedger(ledgerPage);
      onSummaryLoaded?.(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [filter, onSummaryLoaded, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="uc-panel">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3>积分概览</h3>
          <p className="lead">可用积分、消耗与最近积分变化。</p>
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
                ? 'AI 积分不足，请前往购买积分。'
                : CREDIT_LOW_BALANCE_HINT}
            </div>
          ) : null}
          <div className="uc-stat-grid">
            <div className="uc-stat">
              <div className="uc-stat__label">可用积分</div>
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
      ) : null}

      <div className="uc-card !p-2">
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2 pt-1">
          <div className="text-[11px] font-medium text-white/45">积分明细</div>
          <div className="uc-chip-row">
            {(
              [
                ['all', '全部'],
                ['recharge', '购买'],
                ['ai_consume', 'AI 消耗'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`uc-chip ${filter === id ? 'uc-chip--on' : ''}`}
                onClick={() => {
                  setPage(1);
                  setFilter(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {!ledger?.items.length && !loading ? (
          <p className="uc-muted px-2 py-4 text-center">暂无流水记录</p>
        ) : null}

        {ledger?.items.map((item) => {
          const signed = formatLedgerSignedAmount(item);
          const positive = !signed.startsWith('-') || signed === '0';
          return (
            <div key={item.id} className="uc-list-row !items-start">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium">{item.description}</div>
                <div className="uc-muted mt-0.5">
                  {ledgerTypeLabel(item.type, item.sourceType)} · {formatDateTime(item.createdAt)}
                </div>
                <div className="uc-muted mt-0.5 tabular-nums">
                  {formatLedgerBalanceAfter(item.balanceAfter)}
                </div>
              </div>
              <div
                className="shrink-0 text-[13px] font-semibold tabular-nums"
                style={{ color: positive ? '#86efac' : '#fca5a5' }}
              >
                {signed}
              </div>
            </div>
          );
        })}

        {ledger && ledger.totalPages > 1 ? (
          <div className="flex items-center justify-between gap-2 px-2 py-2">
            <button
              type="button"
              className="uc-chip"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </button>
            <span className="uc-muted">
              {page} / {ledger.totalPages}
            </span>
            <button
              type="button"
              className="uc-chip"
              disabled={page >= ledger.totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
