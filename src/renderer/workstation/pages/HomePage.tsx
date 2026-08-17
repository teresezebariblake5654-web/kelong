import { Download, FileUp, History as HistoryIcon, LayoutTemplate } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getTaskTemplate } from '@aw/task-templates';
import type { AgentRole } from '@aw/task-templates';
import { Building2 } from 'lucide-react';
import { MetricCard } from '@workstation/components/common/MetricCard';
import { PageStateView } from '@workstation/components/common/PageStateView';
import { QuotaIndicator } from '@workstation/components/common/QuotaIndicator';
import { QuickActionCard } from '@workstation/components/common/QuickActionCard';
import { UsbDeviceStatus } from '@workstation/components/common/UsbDeviceStatus';
import { PageContainer } from '@workstation/components/layout/PageContainer';
import { RecentTaskTable } from '@workstation/components/templates/RecentTaskTable';
import { TemplateCard } from '@workstation/components/templates/TemplateCard';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@workstation/components/ui/card';
import { greetingByHour } from '@workstation/lib/templateCatalog';
import { templateService, workspaceService } from '@workstation/services';
import type { BusinessTemplate, PageViewState } from '@workstation/types';
import { useTemplateSessionStore } from '@workstation/state/templateSessionStore';
import { useWorkflow } from '@workstation/state/workflow';

const CATEGORY_NAMES: Record<string, string> = {
  hr: '人力资源',
  marketing: '市场/品牌',
  sales: '销售',
  operations: '运营',
  administration: '行政',
  procurement: '采购',
  production: '生产',
  logistics: '物流',
  finance: '财务',
  'customer-service': '客服',
};

export function HomePage() {
  const navigate = useNavigate();
  const { state, patch } = useWorkflow();
  const resetCurrentTemplate = useTemplateSessionStore((s) => s.resetCurrentTemplate);

  const snapshotQuery = useQuery({
    queryKey: ['workspace', 'snapshot'],
    queryFn: () => workspaceService.getSnapshot(),
  });

  const snapshot = snapshotQuery.data;

  const viewState: PageViewState = snapshotQuery.isLoading
    ? 'loading'
    : snapshotQuery.isError
      ? 'error'
      : snapshot?.usb.status === 'offline'
        ? 'usb_offline'
        : !snapshot
          ? 'empty'
          : 'ready';

  async function startTemplate(template: BusinessTemplate) {
    await templateService.recordUse(template.id);
    const task = getTaskTemplate(template.code, template.version);
    if (!task) return;
    resetCurrentTemplate();
    patch({
      role: task.role as AgentRole,
      task,
      estimatedCredits: task.estimatedCredits,
    });
    void snapshotQuery.refetch();
    navigate('/import');
  }

  return (
    <PageContainer>
      <PageStateView
        state={viewState}
        errorMessage={
          snapshotQuery.error instanceof Error ? snapshotQuery.error.message : '工作台加载失败'
        }
        onRetry={() => void snapshotQuery.refetch()}
        onResolveAction={() => navigate(viewState === 'usb_offline' ? '/settings' : '/home')}
      >
        {snapshot ? (
          <>
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-border bg-card px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">
                  {greetingByHour()}，{snapshot.user.displayName}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="size-3.5" />
                    {snapshot.organization.name}
                  </span>
                  <UsbDeviceStatus device={snapshot.usb} />
                  <QuotaIndicator
                    quota={{
                      ...snapshot.quota,
                      balance: state.wallet?.balance ?? snapshot.quota.balance,
                    }}
                  />
                </div>
              </div>
              <Button onClick={() => navigate('/templates')}>开始新任务</Button>
            </section>

            <section className="grid grid-cols-4 gap-3">
              <QuickActionCard
                icon={FileUp}
                title="文件上传"
                description="pdf / word / excel / 图片等"
                onClick={() => navigate('/file-upload')}
              />
              <QuickActionCard
                icon={LayoutTemplate}
                title="选择模板"
                description="打开工作智能体"
                onClick={() => navigate('/templates')}
              />
              <QuickActionCard
                icon={HistoryIcon}
                title="最近任务"
                description="查看历史记录"
                onClick={() => navigate('/history')}
              />
              <QuickActionCard
                icon={Download}
                title="导出文件"
                description={state.structured ? '前往报告导出' : '完成分析后可用'}
                disabled={!state.structured}
                onClick={() => navigate(state.structured ? '/report' : '/templates')}
              />
            </section>

            <div className="grid grid-cols-[1.4fr_1fr] gap-4 max-[1200px]:grid-cols-1">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm">常用模板</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => navigate('/templates')}>
                    全部
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
                    {snapshot.commonTemplates.map((template) => (
                      <TemplateCard
                        key={template.id}
                        template={template}
                        selected={false}
                        dimmed={false}
                        compact
                        categoryName={CATEGORY_NAMES[template.categoryId] ?? template.categoryId}
                        onUse={() => void startTemplate(template)}
                        onToggleFavorite={() => {
                          void templateService.toggleFavorite(template.id).then(() => {
                            void snapshotQuery.refetch();
                          });
                        }}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">数据概览 · 本月</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3">
                    <MetricCard label="本月文件数" value={snapshot.metrics.monthFileCount} />
                    <MetricCard label="完成任务数" value={snapshot.metrics.completedTaskCount} />
                    <MetricCard label="节省时间" value={`${snapshot.metrics.minutesSaved} 分`} />
                    <MetricCard label="额度消耗" value={snapshot.metrics.creditsConsumed} />
                  </div>
                  <OverviewBars metrics={snapshot.metrics} />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">最近任务</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => navigate('/history')}>
                  查看全部
                </Button>
              </CardHeader>
              <CardContent>
                <RecentTaskTable tasks={snapshot.recentTasks} />
              </CardContent>
            </Card>
          </>
        ) : null}
      </PageStateView>
    </PageContainer>
  );
}

function OverviewBars({
  metrics,
}: {
  metrics: { completedTaskCount: number; monthFileCount: number; creditsConsumed: number };
}) {
  const items = [
    { label: '任务', value: metrics.completedTaskCount, max: Math.max(metrics.completedTaskCount, 8) },
    { label: '文件', value: metrics.monthFileCount, max: Math.max(metrics.monthFileCount, 8) },
    { label: '额度', value: metrics.creditsConsumed, max: Math.max(metrics.creditsConsumed, 20) },
  ];
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2 text-xs">
          <span className="w-8 shrink-0 text-muted-foreground">{item.label}</span>
          <progress
            className="h-2 flex-1 overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary/80 [&::-moz-progress-bar]:bg-primary/80"
            value={item.value}
            max={item.max}
          />
          <span className="w-8 text-right font-mono tabular-nums text-muted-foreground">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
