import { LoaderCircle } from 'lucide-react';
import { useElapsedSeconds } from '@workstation/hooks/useElapsedSeconds';
import { cn } from '@workstation/lib/utils';

type ReplyGeneratingIndicatorProps = {
  active: boolean;
  /** waiting = 首字未出；streaming = 已有内容仍在生成 */
  phase?: 'waiting' | 'streaming';
  className?: string;
};

function formatElapsed(seconds: number) {
  if (seconds <= 0) return '刚开始';
  if (seconds < 60) return `${seconds} 秒`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs ? `${mins} 分 ${secs} 秒` : `${mins} 分`;
}

export function ReplyGeneratingIndicator({
  active,
  phase = 'waiting',
  className,
}: ReplyGeneratingIndicatorProps) {
  const seconds = useElapsedSeconds(active);

  if (phase === 'streaming') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs text-slate-400', className)}>
        <span
          className="inline-block h-3.5 w-[2px] animate-pulse bg-indigo-400 align-middle"
          aria-hidden
        />
        撰写中 · {formatElapsed(seconds)}
      </span>
    );
  }

  return (
    <div className={cn('flex items-center gap-2.5 text-sm text-slate-500', className)}>
      <LoaderCircle className="size-4 shrink-0 animate-spin text-indigo-500" />
      <span className="font-medium tabular-nums text-slate-600">
        思考中 · {formatElapsed(seconds)}
      </span>
    </div>
  );
}
