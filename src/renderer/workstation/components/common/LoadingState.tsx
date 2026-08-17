import { LoaderCircle } from 'lucide-react';
import { cn } from '@workstation/lib/utils';

type LoadingStateProps = {
  message?: string;
  className?: string;
};

/** Compact inline loading row used by auth/wallet pages. */
export function LoadingState({ message = '加载中…', className }: LoadingStateProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[12px] border border-border bg-muted/60 px-4 py-3 text-sm text-muted-foreground',
        className,
      )}
    >
      <LoaderCircle className="size-4 animate-spin text-primary" />
      <span>{message}</span>
    </div>
  );
}
