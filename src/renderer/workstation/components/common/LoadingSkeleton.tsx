import { cn } from '@workstation/lib/utils';

type LoadingSkeletonProps = {
  rows?: number;
  className?: string;
};

export function LoadingSkeleton({ rows = 3, className }: LoadingSkeletonProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)} aria-busy aria-label="加载中">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-16 animate-pulse rounded-[12px] border border-border bg-muted/70"
        />
      ))}
    </div>
  );
}
