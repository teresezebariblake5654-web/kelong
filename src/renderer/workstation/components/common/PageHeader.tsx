import type { ReactNode } from 'react';
import { cn } from '@workstation/lib/utils';

type PageHeaderProps = {
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ title, lead, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {lead ? <div className="mt-1 text-sm text-muted-foreground">{lead}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}
