import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { listTasksByRole } from '@aw/task-templates';
import { PageHeader, EmptyState } from '@workstation/components/common';
import { Badge } from '@workstation/components/ui/badge';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader } from '@workstation/components/ui/card';
import { roleLabel } from '@workstation/constants/workflow';
import { cn } from '@workstation/lib/utils';
import { useWorkflow } from '@workstation/state/workflow';

export function TasksPage() {
  const navigate = useNavigate();
  const { state, patch } = useWorkflow();
  const tasks = useMemo(
    () => (state.role ? listTasksByRole(state.role).filter((t) => t.enabled) : []),
    [state.role],
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Card>
        <CardHeader>
          <PageHeader
            title="选择任务模板"
            lead={`岗位「${roleLabel(state.role)}」可用模板。本地完成清洗与统计后，再按预计 AI 积分调用云端总结。`}
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!tasks.length ? (
            <EmptyState message="该岗位暂无可用模板。" />
          ) : (
            <div className="flex flex-col gap-2">
              {tasks.map((task) => {
                const selected = state.task?.code === task.code;
                return (
                  <button
                    key={task.code}
                    type="button"
                    className={cn(
                      'rounded-[12px] border p-4 text-left transition-colors',
                      selected
                        ? 'border-primary bg-accent shadow-[inset_0_0_0_1px_hsl(var(--primary))]'
                        : 'border-border bg-card hover:border-primary/30 hover:bg-muted/40',
                    )}
                    onClick={() =>
                      patch({
                        task,
                        estimatedCredits: task.estimatedCredits,
                        templateResult: undefined,
                        fieldMappings: undefined,
                        structured: undefined,
                        analysisText: undefined,
                        analysisResult: undefined,
                        taskId: undefined,
                      })
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <strong className="text-sm">{task.name}</strong>
                      <Badge variant="warning">预计 {task.estimatedCredits} 额度</Badge>
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">{task.description}</div>
                    <div className="mt-2 text-xs text-muted-foreground/80">
                      必填字段：
                      {task.fields.filter((f) => f.required).map((f) => f.label).join('、') || '无'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <Button disabled={!state.task} onClick={() => navigate('/import')}>
            下一步：导入文件
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
