import { Badge } from '@workstation/components/ui/badge';
import type { TaskStatus } from '@workstation/types';

const STATUS_MAP: Record<
  TaskStatus,
  { label: string; variant: 'success' | 'danger' | 'warning' | 'secondary' }
> = {
  completed: { label: '已完成', variant: 'success' },
  failed: { label: '失败', variant: 'danger' },
  running: { label: '进行中', variant: 'warning' },
  queued: { label: '排队中', variant: 'secondary' },
  cancelled: { label: '已取消', variant: 'secondary' },
};

type StatusBadgeProps = {
  status: TaskStatus;
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const item = STATUS_MAP[status];
  return <Badge variant={item.variant}>{item.label}</Badge>;
}
