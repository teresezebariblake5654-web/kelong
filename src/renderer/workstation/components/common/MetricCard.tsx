import { cn } from '@workstation/lib/utils';

type MetricCardProps = {
  label: string;
  value: string | number;
  mono?: boolean;
  className?: string;
};

export function MetricCard({ label, value, mono = true, className }: MetricCardProps) {
  return (
    <div className={cn('rounded-[12px] border border-border bg-muted/40 p-4', className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 truncate text-lg font-semibold',
          mono && 'font-mono tabular-nums',
        )}
      >
        {value}
      </div>
    </div>
  );
}
