import type { ReactNode } from 'react';
import { cn } from '@workstation/lib/utils';

type EmptyStateProps = {
  title?: string;
  message: string;
  className?: string;
  action?: ReactNode;
};

export function EmptyState({ title, message, className, action }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-dashed border-border bg-muted/40 px-4 py-8 text-center',
        className,
      )}
    >
      {title ? <div className="text-sm font-medium text-foreground">{title}</div> : null}
      <div className={cn('text-sm text-muted-foreground', title && 'mt-1')}>{message}</div>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
