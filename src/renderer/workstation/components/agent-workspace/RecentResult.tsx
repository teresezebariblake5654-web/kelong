import type { AgentRecentResultData } from '@workstation/mocks/agentWorkspace';
import { cn } from '@workstation/lib/utils';

type RecentResultProps = {
  data: AgentRecentResultData;
  accent: string;
  onPrimary: () => void;
  onSecondary: () => void;
  className?: string;
};

export function RecentResult({
  data,
  accent,
  onPrimary,
  onSecondary,
  className,
}: RecentResultProps) {
  return (
    <section
      className={cn(
        'rounded-[20px] border border-slate-200/80 bg-white/85 p-5 shadow-[0_8px_28px_-20px_rgba(15,23,42,0.28)] backdrop-blur-sm',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{data.title}</h3>
          <p className="mt-1 text-xs text-slate-400">完成于 {data.completedAt}</p>
        </div>
        {!data.fromHistory ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
            示例数据
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 max-[1100px]:grid-cols-1">
        {data.stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-[14px] border border-slate-100 bg-slate-50/80 px-3 py-2.5"
          >
            <div className="text-[11px] text-slate-500">{stat.label}</div>
            <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              {stat.value}
              {stat.alert ? (
                <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">
                  异常
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <div className="text-xs font-medium text-slate-600">{data.analysisTitle}</div>
        <ul className="mt-2 space-y-1.5">
          {data.analysisItems.map((item) => (
            <li key={item} className="flex gap-2 text-xs leading-relaxed text-slate-500">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-slate-300" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onSecondary}
          className="h-9 rounded-full border border-slate-200 bg-white px-4 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
        >
          {data.secondaryAction}
        </button>
        <button
          type="button"
          onClick={onPrimary}
          className="h-9 rounded-full px-4 text-xs font-medium text-white shadow-sm transition-opacity hover:opacity-90"
          style={{ background: `linear-gradient(135deg, ${accent}, #6366F1)` }}
        >
          {data.primaryAction}
        </button>
      </div>
    </section>
  );
}
