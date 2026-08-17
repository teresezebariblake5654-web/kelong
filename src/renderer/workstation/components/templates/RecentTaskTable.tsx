import { StatusBadge } from '@workstation/components/common/StatusBadge';
import { EmptyState } from '@workstation/components/common/EmptyState';
import type { ProcessingTask } from '@workstation/types';

type RecentTaskTableProps = {
  tasks: ProcessingTask[];
  limit?: number;
};

export function RecentTaskTable({ tasks, limit = 8 }: RecentTaskTableProps) {
  if (!tasks.length) {
    return <EmptyState message="暂无任务。从「开始新任务」或常用模板启动。" />;
  }

  return (
    <div className="overflow-x-auto rounded-[10px] border border-border">
      <table className="w-full min-w-[720px] border-separate border-spacing-0 text-xs">
        <thead>
          <tr className="bg-muted/60 text-left text-muted-foreground">
            {['文件名', '模板', '时间', '状态', '进度', '消耗'].map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.slice(0, limit).map((item) => (
            <tr key={item.id} className="hover:bg-muted/30">
              <td className="max-w-[180px] truncate border-t border-border px-3 py-2 font-medium">
                {item.fileName || '—'}
              </td>
              <td className="border-t border-border px-3 py-2">{item.templateName}</td>
              <td className="whitespace-nowrap border-t border-border px-3 py-2 text-muted-foreground">
                {new Date(item.createdAt).toLocaleString('zh-CN')}
              </td>
              <td className="border-t border-border px-3 py-2">
                <StatusBadge status={item.status} />
              </td>
              <td className="border-t border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <progress
                    className="h-1.5 w-16 overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
                    value={item.progress}
                    max={100}
                  />
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {item.progress}%
                  </span>
                </div>
              </td>
              <td className="border-t border-border px-3 py-2 font-mono tabular-nums">
                {item.creditsCharged || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
