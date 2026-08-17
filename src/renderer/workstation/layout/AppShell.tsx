import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppHeader } from '@workstation/components/layout/AppHeader';
import { AppSidebar } from '@workstation/components/layout/AppSidebar';
import { TopLeftControls } from '@workstation/components/layout/TopLeftControls';
import { TopRightControls } from '@workstation/components/layout/TopRightControls';
import { Button } from '@workstation/components/ui/button';
import { WORKFLOW_STEPS } from '@workstation/constants/workflow';
import { goToTemplatesCenter } from '@workstation/lib/templateNavigation';
import { cn } from '@workstation/lib/utils';

const AUTH_ONLY_PATHS = ['/launch', '/activate'];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const authOnly = AUTH_ONLY_PATHS.includes(location.pathname);
  const isChatPage = location.pathname === '/chat';
  const isDepartmentWorkspace = /^\/templates\/[^/]+$/.test(location.pathname);
  const immersiveChat = isChatPage || isDepartmentWorkspace;
  const stepIndex = WORKFLOW_STEPS.findIndex((step) => step.path === location.pathname);
  const inWorkflow = stepIndex >= 0;
  const currentKey = stepIndex >= 0 ? WORKFLOW_STEPS[stepIndex]?.key : undefined;
  const prevPath = stepIndex > 0 ? WORKFLOW_STEPS[stepIndex - 1]?.path : undefined;
  const showFooterNext =
    currentKey !== 'progress' && currentKey !== 'report' && currentKey !== 'history';
  const nextPath =
    showFooterNext && stepIndex >= 0 && stepIndex < WORKFLOW_STEPS.length - 1
      ? WORKFLOW_STEPS[stepIndex + 1]?.path
      : undefined;

  if (authOnly) {
    return (
      <div className="flex h-full min-h-[720px] min-w-[1280px] bg-background">
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-[1100px] overflow-hidden bg-background">
      <AppSidebar />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopLeftControls />
        <TopRightControls />
        {!immersiveChat ? <AppHeader /> : null}
        <main
          className={cn(
            'min-h-0 min-w-0 flex-1',
            immersiveChat ? 'overflow-hidden p-0' : 'overflow-auto p-5',
          )}
        >
          <Outlet />
        </main>
        {inWorkflow ? (
          <footer className="flex h-12 shrink-0 items-center justify-between gap-4 border-t border-border bg-card px-5">
            <div className="text-xs text-muted-foreground">原始文件仅在本地处理，不会默认上传。</div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => goToTemplatesCenter(navigate)}>
                返回工作智能体
              </Button>
              {prevPath ? (
                <Button variant="outline" size="sm" onClick={() => navigate(prevPath)}>
                  上一步
                </Button>
              ) : null}
              {nextPath ? (
                <Button size="sm" onClick={() => navigate(nextPath)}>
                  下一步
                </Button>
              ) : null}
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
