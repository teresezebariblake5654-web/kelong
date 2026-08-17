import type { AgentStatusBarData } from '@workstation/mocks/agentWorkspace';
import { cn } from '@workstation/lib/utils';

type StatusBarProps = {
  data: AgentStatusBarData;
  className?: string;
};

export function StatusBar({ data, className }: StatusBarProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[16px] border border-slate-200/80',
        'bg-white/75 px-4 py-3 text-xs shadow-[0_6px_20px_-16px_rgba(15,23,42,0.25)] backdrop-blur-sm',
        className,
      )}
    >
      <div className="flex items-center gap-2 font-medium text-slate-700">
        <span
          className={cn(
            'size-2 rounded-full',
            data.running ? 'animate-pulse bg-emerald-500' : 'bg-slate-300',
          )}
        />
        {data.title}
      </div>

      <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-slate-500">
        {data.metrics.map((metric, index) => (
          <span key={metric.label} className="inline-flex items-center gap-2">
            {index > 0 ? <span className="text-slate-300">|</span> : null}
            <span>
              {metric.label}{' '}
              <span className="font-semibold tabular-nums text-slate-700">{metric.value}</span>
            </span>
          </span>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <svg width="72" height="22" viewBox="0 0 72 22" className="text-indigo-400 opacity-80" aria-hidden>
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            points="0,16 10,12 18,14 28,7 38,10 48,5 58,9 72,3"
          />
        </svg>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-600">
          系统状态：{data.health}
        </span>
      </div>
    </div>
  );
}
