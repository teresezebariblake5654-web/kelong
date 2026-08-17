import { Coins } from 'lucide-react';
import { Badge } from '@workstation/components/ui/badge';
import type { UsageQuota } from '@workstation/types';
import { cn } from '@workstation/lib/utils';

type QuotaIndicatorProps = {
  quota: UsageQuota | null | undefined;
  className?: string;
};

export function QuotaIndicator({ quota, className }: QuotaIndicatorProps) {
  if (!quota) {
    return (
      <Badge variant="secondary" className={cn('gap-1', className)}>
        <Coins className="size-3" />
        额度 —
      </Badge>
    );
  }

  const low = quota.balance <= quota.lowBalanceThreshold;
  return (
    <Badge variant={low ? 'warning' : 'success'} className={cn('gap-1 font-mono tabular-nums', className)}>
      <Coins className="size-3" />
      剩余 {quota.balance}
    </Badge>
  );
}
