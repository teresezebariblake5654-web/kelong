import { Button } from '@workstation/components/ui/button';
import { cn } from '@workstation/lib/utils';

type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
};

export function ErrorState({
  title = '加载失败',
  message,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-destructive/30 bg-destructive/5 px-4 py-4',
        className,
      )}
    >
      <div className="text-sm font-medium text-destructive">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{message}</div>
      {onRetry ? (
        <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>
          重新加载
        </Button>
      ) : null}
    </div>
  );
}
