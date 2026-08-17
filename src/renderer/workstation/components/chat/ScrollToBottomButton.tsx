import { ArrowDown } from 'lucide-react';
import { cn } from '@workstation/lib/utils';

type ScrollToBottomButtonProps = {
  visible: boolean;
  onClick: () => void;
  className?: string;
};

export function ScrollToBottomButton({ visible, onClick, className }: ScrollToBottomButtonProps) {
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'absolute bottom-4 left-1/2 z-10 flex size-9 -translate-x-1/2 items-center justify-center',
        'rounded-full border border-slate-200/90 bg-white text-slate-600 shadow-md',
        'transition hover:bg-slate-50 hover:text-slate-800',
        className,
      )}
      aria-label="回到最新消息"
      title="回到最新消息"
    >
      <ArrowDown className="size-4" />
    </button>
  );
}
