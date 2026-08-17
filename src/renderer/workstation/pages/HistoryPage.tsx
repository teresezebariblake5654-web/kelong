import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, EmptyState } from '@workstation/components/common';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@workstation/components/ui/card';
import { roleLabel } from '@workstation/constants/workflow';
import { useWalletQuery } from '@workstation/hooks/useCloudQueries';
import {
  relinkHistoryWithSessions,
  resolveSessionForHistoryItem,
} from '@workstation/lib/departmentTaskSessions';
import type { HistoryItem } from '@workstation/lib/localStore';
import { loadHistory } from '@workstation/lib/localStore';
import { cn } from '@workstation/lib/utils';
import { useWorkflow } from '@workstation/state/workflow';

export function HistoryPage() {
  const navigate = useNavigate();
  const { state } = useWorkflow();
  useWalletQuery(true);
  const [history, setHistory] = useState<HistoryItem[]>(() =>
    relinkHistoryWithSessions(loadHistory()),
  );

  useEffect(() => {
    setHistory(relinkHistoryWithSessions(loadHistory()));
  }, [state.taskId, state.analysisText]);

  const openHistoryItem = (item: HistoryItem) => {
    const session = resolveSessionForHistoryItem(item);
    if (!session) {
      navigate('/templates');
      return;
    }
    navigate(`/templates/${session.departmentCode}?session=${session.id}`);
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Card>
        <CardHeader>
          <PageHeader
            title="任务历史与额度"
            lead="点击任务可打开完整对话记录，查看 AI 分析结果并继续追问。"
            actions={
              <Button onClick={() => navigate('/templates')}>打开工作智能体</Button>
            }
          />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="当前额度" value={String(state.wallet?.balance ?? '—')} />
            <Metric label="累计消耗" value={String(state.wallet?.totalConsumed ?? '—')} />
            <Metric label="历史任务" value={String(history.length)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>最近任务</CardTitle>
        </CardHeader>
        <CardContent>
          {!history.length ? (
            <EmptyState message="暂无历史记录。完成一次分析后将自动保存。" />
          ) : (
            <div className="flex flex-col gap-2">
              {history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openHistoryItem(item)}
                  className={cn(
                    'rounded-[12px] border border-border p-4 text-left transition-colors',
                    'hover:border-primary/40 hover:bg-muted/30',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <strong className="text-sm">{item.taskName}</strong>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    {item.fileName || '无附件'} · {roleLabel(item.role)} · 点击查看对话
                  </div>
                  {item.summary ? (
                    <div className="mt-2 line-clamp-2 text-sm text-foreground/80">{item.summary}</div>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-border bg-muted/40 p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
