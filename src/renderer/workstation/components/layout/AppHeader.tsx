import { Moon, Sun } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QuotaIndicator } from '@workstation/components/common/QuotaIndicator';
import { PageBackButton } from '@workstation/components/layout/PageBackButton';
import { PageNextButton } from '@workstation/components/layout/PageNextButton';
import { WorkflowStepper } from '@workstation/components/WorkflowStepper';
import { Badge } from '@workstation/components/ui/badge';
import { Button } from '@workstation/components/ui/button';
import { roleLabel, WORKFLOW_STEPS } from '@workstation/constants/workflow';
import { shouldShowPageBack, shouldShowPageNext } from '@workstation/lib/pageNavigation';
import { workspaceService } from '@workstation/services';
import { useUiStore } from '@workstation/state/uiStore';
import { useWorkflow } from '@workstation/state/workflow';

const PAGE_TITLES: Record<string, string> = {
  '/chat': 'AI 助手',
  '/home': '工作台',
  '/templates': '工作智能体',
  '/roles': '选择岗位',
  '/tasks': '选择任务模板',
  '/import': '任务页面',
  '/sheet': '选择工作表',
  '/mapping': '确认字段映射',
  '/clean': '数据清洗预览',
  '/anomalies': '异常与统计',
  '/progress': 'AI 分析进度',
  '/report': '结构化报告',
  '/file-upload': '文件上传',
  '/image-analysis': '图片智能识别',
  '/history': '任务历史',
  '/quota': '额度消耗',
  '/files': '文件库',
  '/wallet': '额度消耗',
  '/account': '账户信息',
  '/account/credits': '分析额度',
  '/account/help': '帮助与支持',
  '/settings': '账户信息',
};

export function AppHeader() {
  const location = useLocation();
  const { state } = useWorkflow();
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const title = PAGE_TITLES[location.pathname] ?? '智力魔盒';
  const inWorkflow = WORKFLOW_STEPS.some((step) => step.path === location.pathname);
  const showBack = shouldShowPageBack(location.pathname);
  const showNext = shouldShowPageNext(location.pathname);
  const quotaQuery = useQuery({
    queryKey: ['workspace', 'quota'],
    queryFn: () => workspaceService.getQuota(),
    staleTime: 30_000,
  });

  const quota = quotaQuery.data
    ? {
        ...quotaQuery.data,
        balance: state.wallet?.balance ?? quotaQuery.data.balance,
      }
    : state.wallet
      ? {
          balance: state.wallet.balance,
          reserved: state.wallet.reservedBalance,
          monthlyConsumed: state.wallet.totalConsumed,
          monthlyGranted: state.wallet.totalGranted,
          lowBalanceThreshold: 50,
        }
      : null;

  return (
    <header className="flex h-[52px] min-w-0 items-center gap-3 border-b border-border bg-card px-5">
      {showBack ? <PageBackButton /> : null}
      <div className="min-w-0 shrink-0 basis-48">
        <div className="truncate text-sm font-semibold text-foreground">{title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {state.task?.name ?? roleLabel(state.role)}
          {state.fileName ? ` · ${state.fileName}` : ''}
        </div>
      </div>

      {inWorkflow ? (
        <div className="min-w-0 flex-1 overflow-hidden">
          <WorkflowStepper />
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <div className="flex shrink-0 items-center gap-2">
        {showNext ? <PageNextButton /> : null}
        <QuotaIndicator quota={quota} />
        {state.task ? (
          <Badge variant="warning" className="tabular-nums">
            预计 {state.task.estimatedCredits}
          </Badge>
        ) : null}
        <Button
          variant="outline"
          size="icon"
          onClick={toggleTheme}
          aria-label="切换主题"
          title="切换主题"
        >
          {theme === 'light' ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </Button>
      </div>
    </header>
  );
}
