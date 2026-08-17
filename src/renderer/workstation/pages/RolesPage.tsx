import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@workstation/components/common';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader } from '@workstation/components/ui/card';
import { ROLE_OPTIONS } from '@workstation/constants/workflow';
import { cn } from '@workstation/lib/utils';
import { useWorkflow } from '@workstation/state/workflow';

export function RolesPage() {
  const navigate = useNavigate();
  const { state, patch, resetPipeline } = useWorkflow();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <Card>
        <CardHeader>
          <PageHeader
            title="选择岗位"
            lead="共 10 个岗位。选定后进入对应任务模板，后续操作路径保持一致。"
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-5 gap-3 max-[1400px]:grid-cols-3 max-[1100px]:grid-cols-2">
            {ROLE_OPTIONS.map((role, index) => {
              const selected = state.role === role.id;
              return (
                <motion.button
                  key={role.id}
                  type="button"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15, delay: index * 0.02 }}
                  className={cn(
                    'rounded-[12px] border bg-card p-4 text-left transition-colors',
                    selected
                      ? 'border-primary bg-accent shadow-[inset_0_0_0_1px_hsl(var(--primary))]'
                      : 'border-border hover:border-primary/30 hover:bg-muted/40',
                  )}
                  onClick={() => {
                    resetPipeline();
                    patch({ role: role.id, error: undefined });
                  }}
                >
                  <strong className="text-sm text-foreground">{role.title}</strong>
                  <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{role.desc}</div>
                </motion.button>
              );
            })}
          </div>
          <div>
            <Button disabled={!state.role} onClick={() => navigate('/tasks')}>
              下一步：选择任务模板
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
