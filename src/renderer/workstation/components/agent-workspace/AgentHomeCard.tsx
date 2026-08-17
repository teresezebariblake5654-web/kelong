import { FileUp, MessageCircle, Sparkles } from 'lucide-react';
import { cn } from '@workstation/lib/utils';

type AgentHomeCardProps = {
  agentName: string;
  slogan: string;
  accent: string;
  iconBg: string;
  quickActions: string[];
  onQuickAction: (text: string) => void;
  onUploadClick: () => void;
  onAskClick: () => void;
  className?: string;
};

/**
 * Apple-glass empty-state card for a department agent home.
 */
export function AgentHomeCard({
  agentName,
  slogan,
  accent,
  iconBg,
  quickActions,
  onQuickAction,
  onUploadClick,
  onAskClick,
  className,
}: AgentHomeCardProps) {
  return (
    <section
      className={cn(
        'apple-glass relative mx-auto w-full max-w-[720px] overflow-hidden rounded-[28px] px-6 py-7 sm:px-8 sm:py-8',
        className,
      )}
    >
      <div
        className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full opacity-50 blur-3xl"
        style={{ background: accent }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-20 -left-8 size-48 rounded-full opacity-30 blur-3xl"
        style={{ background: accent }}
        aria-hidden
      />

      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
        <div
          className="mx-auto flex size-[108px] shrink-0 items-center justify-center rounded-[28px] shadow-[0_18px_40px_-24px_rgba(15,23,42,0.45)] sm:mx-0"
          style={{ background: iconBg }}
        >
          <Sparkles className="size-12 text-white drop-shadow" strokeWidth={1.5} />
        </div>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <h2 className="text-[22px] font-semibold tracking-tight text-slate-900 sm:text-[24px]">
            {agentName}智能体
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{slogan}</p>

          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            {quickActions.slice(0, 4).map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => onQuickAction(action)}
                className="rounded-full border border-white/80 bg-white/55 px-3 py-1.5 text-[11px] font-medium text-slate-600 backdrop-blur-md transition hover:bg-white hover:text-slate-900"
              >
                {action}
              </button>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5 sm:justify-start">
            <button
              type="button"
              onClick={onUploadClick}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_-14px_rgba(15,23,42,0.55)] transition hover:brightness-110"
              style={{ background: accent }}
            >
              <FileUp className="size-4" />
              上传文件
            </button>
            <button
              type="button"
              onClick={onAskClick}
              className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/70 px-4 py-2.5 text-sm font-semibold text-slate-700 backdrop-blur-md transition hover:bg-white"
            >
              <MessageCircle className="size-4" />
              直接提问
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
