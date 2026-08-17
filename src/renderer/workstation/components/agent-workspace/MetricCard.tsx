import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@workstation/lib/utils';

type MetricCardProps = {
  label: string;
  value: string | number;
  trend?: string;
  trendPositive?: boolean;
  hint?: string;
  className?: string;
};

/** 工作台统计卡片：大数字 + 趋势/提示 */
export function MetricCard({
  label,
  value,
  trend,
  trendPositive = true,
  hint,
  className,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        'rounded-[20px] border border-slate-200/80 bg-white/80 p-4 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.25)]',
        'backdrop-blur-sm transition-transform duration-200 hover:-translate-y-0.5',
        className,
      )}
    >
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-2 truncate text-[28px] font-semibold leading-none tracking-tight text-slate-800 tabular-nums">
        {value}
      </div>
      {trend ? (
        <div
          className={cn(
            'mt-2.5 flex items-center gap-1 text-[11px] font-medium',
            trendPositive ? 'text-emerald-600' : 'text-rose-500',
          )}
        >
          {trendPositive ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
          {trend}
        </div>
      ) : null}
      {hint ? <div className="mt-2.5 text-[11px] text-slate-400">{hint}</div> : null}
    </div>
  );
}
