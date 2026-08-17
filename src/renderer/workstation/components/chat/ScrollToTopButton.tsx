import { ArrowUp } from 'lucide-react';
import { cn } from '@workstation/lib/utils';

type ScrollToTopButtonProps = {
  visible: boolean;
  onClick: () => void;
  className?: string;
};

export function ScrollToTopButton({ visible, onClick, className }: ScrollToTopButtonProps) {
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'absolute right-4 top-4 z-10 flex size-9 items-center justify-center',
        'rounded-full border border-slate-200/90 bg-white text-slate-600 shadow-md',
        'transition hover:bg-slate-50 hover:text-slate-800',
        className,
      )}
      aria-label="回到对话顶部"
      title="回到顶部"
    >
      <ArrowUp className="size-4" />
    </button>
  );
}
