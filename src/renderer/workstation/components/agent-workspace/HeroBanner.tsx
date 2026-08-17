import type { CSSProperties } from 'react';
import { motion } from 'motion/react';
import { Sparkles } from 'lucide-react';
import { usePrefersReducedMotion } from '@workstation/hooks/usePrefersReducedMotion';
import { cn } from '@workstation/lib/utils';

type HeroBannerProps = {
  agentId: string;
  title: string;
  slogan: string;
  themeColor: string;
  heroBackground: string;
  agentName: string;
  modeLabel: string;
  modeSelected: boolean;
  fileHint: string;
  prompts: string[];
  onSelectPrompt: (text: string) => void;
  className?: string;
};

/**
 * Compact top prompt bar (~1/4 viewport). Scrolls inside if many prompts.
 */
export function HeroBanner({
  agentId,
  title,
  slogan,
  themeColor,
  heroBackground,
  agentName,
  modeLabel,
  modeSelected,
  fileHint,
  prompts,
  onSelectPrompt,
  className,
}: HeroBannerProps) {
  const reduced = usePrefersReducedMotion();

  return (
    <motion.section
      className={cn(
        'relative max-h-[26vh] min-h-0 overflow-hidden rounded-[18px] border border-white/70',
        'shadow-[0_12px_28px_-22px_rgba(79,70,229,0.35)] backdrop-blur-md',
        className,
      )}
      style={{ background: heroBackground }}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      data-agent-id={agentId}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 55% 70% at 8% 20%, ${themeColor}22, transparent 60%),
            radial-gradient(ellipse 45% 55% at 92% 15%, ${themeColor}14, transparent 55%)
          `,
        }}
      />

      <div className="relative flex max-h-[26vh] flex-col gap-2 px-4 py-3">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="mb-0.5 inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/55 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
              <Sparkles className="size-3" style={{ color: themeColor }} />
              {agentName} · AI 引导
            </div>
            <h2 className="truncate text-[16px] font-semibold leading-tight tracking-tight text-slate-800">
              {title}
            </h2>
            <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">
              {modeSelected ? `「${modeLabel}」· ${fileHint}` : slogan}
            </p>
          </div>
          <p
            className="prompt-jelly-title shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide text-white"
            style={{
              background: `linear-gradient(135deg, ${themeColor} 0%, ${themeColor}CC 100%)`,
            }}
          >
            点提示词或直接提问 · 上传可选
          </p>
        </div>

        {!modeSelected ? (
          <div className="rounded-xl border border-dashed border-slate-300/80 bg-white/45 px-3 py-3 text-center">
            <p className="text-xs font-medium text-slate-600">请先在右侧选择工作模式</p>
          </div>
        ) : (
          <div
            className={cn(
              'min-h-0 flex-1 overflow-y-auto pr-0.5',
              '[&::-webkit-scrollbar]:w-1',
              '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300/80',
            )}
          >
            <div className="grid grid-cols-2 gap-1.5 max-[900px]:grid-cols-1 lg:grid-cols-3">
              {prompts.map((prompt, index) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => onSelectPrompt(prompt)}
                  className="prompt-jelly-chip prompt-jelly-chip--compact group text-left"
                  title={prompt}
                  style={
                    {
                      '--chip-accent': themeColor,
                    } as CSSProperties
                  }
                >
                  <span className="prompt-jelly-chip__index">{index + 1}</span>
                  <span className="prompt-jelly-chip__text line-clamp-2">{prompt}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.section>
  );
}
