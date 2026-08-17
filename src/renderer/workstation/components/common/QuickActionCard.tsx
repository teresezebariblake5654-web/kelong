import type { LucideIcon } from 'lucide-react';
import { cn } from '@workstation/lib/utils';

type QuickActionCardProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
};

export function QuickActionCard({
  icon: Icon,
  title,
  description,
  onClick,
  disabled,
}: QuickActionCardProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'group rounded-[12px] border border-border bg-card p-4 text-left transition-all',
        'hover:border-primary/40 hover:bg-accent/40 active:scale-[0.98]',
        'disabled:pointer-events-none disabled:opacity-45',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <div className="flex size-8 items-center justify-center rounded-[10px] bg-muted text-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
        <Icon className="size-4" />
      </div>
      <div className="mt-3 text-sm font-medium">{title}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
    </button>
  );
}
