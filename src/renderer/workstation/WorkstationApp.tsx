import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { DepartmentWorkspacePage } from '@workstation/pages/DepartmentWorkspacePage';
import { WorkstationHomePage } from '@workstation/pages/WorkstationHomePage';
import { getDepartmentAgent, type DepartmentAgent } from '@workstation/data/departmentAgents';
import { queryClient } from '@workstation/lib/queryClient';
import { healthCheck, type HealthCheckResult } from '@workstation/services/workstationApi';
import { ThemeProvider } from '@workstation/theme/ThemeProvider';
import {
  WorkstationBackendProvider,
} from '@workstation/WorkstationBackendContext';
import { TooltipProvider } from '@workstation/components/ui/tooltip';
import { cn } from '@workstation/lib/utils';
import { resolveAvatarDisplayUrl } from '@workstation/lib/avatarUrl';
import { getUserAccessToken, loadUserProfile } from '@workstation/lib/localStore';
import { useUserCenterStore } from '@workstation/state/userCenterStore';
import { useUiStore } from '@workstation/state/uiStore';
import { UserCenterDrawer, UserCenterTrigger } from '@workstation/user-center';
import { WorkstationLlmKeyGate, useWorkstationLlmConfigured } from '@workstation/components/WorkstationLlmKeyGate';
import {
  needsWorkstationLlmKey,
  WORKSTATION_LLM_KEY_REQUEST_EVENT,
} from '@workstation/services/workstationLlmPreset';
import '@workstation/styles/workstation-scoped.css';
import '@workstation/components/departments/departmentIcons.css';
import '@workstation/user-center/userCenter.css';
import brandMarkUrl from '@workstation/assets/brand/workhorse-mark.png';

const ProductionWorkflowHomePage = lazy(() =>
  import('@workstation/pages/production/ProductionWorkflowHomePage').then((m) => ({
    default: m.ProductionWorkflowHomePage,
  })),
);
const ProductionWorkflowRunPage = lazy(() =>
  import('@workstation/pages/production/ProductionWorkflowRunPage').then((m) => ({
    default: m.ProductionWorkflowRunPage,
  })),
);
const HrWorkflowHomePage = lazy(() =>
  import('@workstation/pages/workflows/HrWorkflowHomePage').then((m) => ({ default: m.HrWorkflowHomePage })),
);
const HrWorkflowRunPage = lazy(() =>
  import('@workstation/pages/workflows/HrWorkflowRunPage').then((m) => ({ default: m.HrWorkflowRunPage })),
);
const FinanceWorkflowHomePage = lazy(() =>
  import('@workstation/pages/workflows/FinanceWorkflowHomePage').then((m) => ({
    default: m.FinanceWorkflowHomePage,
  })),
);
const FinanceWorkflowRunPage = lazy(() =>
  import('@workstation/pages/workflows/FinanceWorkflowRunPage').then((m) => ({
    default: m.FinanceWorkflowRunPage,
  })),
);
const EcommerceWorkflowHomePage = lazy(() =>
  import('@workstation/pages/workflows/EcommerceWorkflowHomePage').then((m) => ({
    default: m.EcommerceWorkflowHomePage,
  })),
);
const EcommerceWorkflowRunPage = lazy(() =>
  import('@workstation/pages/workflows/EcommerceWorkflowRunPage').then((m) => ({
    default: m.EcommerceWorkflowRunPage,
  })),
);
const LogisticsWorkflowHomePage = lazy(() =>
  import('@workstation/pages/workflows/LogisticsWorkflowHomePage').then((m) => ({
    default: m.LogisticsWorkflowHomePage,
  })),
);
const LogisticsWorkflowRunPage = lazy(() =>
  import('@workstation/pages/workflows/LogisticsWorkflowRunPage').then((m) => ({
    default: m.LogisticsWorkflowRunPage,
  })),
);
const AdminWorkflowHomePage = lazy(() =>
  import('@workstation/pages/workflows/AdminWorkflowHomePage').then((m) => ({
    default: m.AdminWorkflowHomePage,
  })),
);
const AdminWorkflowRunPage = lazy(() =>
  import('@workstation/pages/workflows/AdminWorkflowRunPage').then((m) => ({
    default: m.AdminWorkflowRunPage,
  })),
);
const MaterialDailyClosePage = lazy(() =>
  import('@workstation/pages/MaterialDailyClosePage').then((m) => ({ default: m.MaterialDailyClosePage })),
);
const ProductionClosePage = lazy(() =>
  import('@workstation/pages/productionClose/ProductionClosePage').then((m) => ({
    default: m.ProductionClosePage,
  })),
);

const LAST_DEPARTMENT_KEY = 'lobsterai.workstation.lastDepartment';

export type WorkstationAppProps = {
  onEnterLobster: () => void;
  /** True while on department-picker cinematic home (`/`). */
  onCinematicHomeChange?: (isHome: boolean) => void;
};

type InternalView = 'home' | 'workbench';

function readLastDepartment(): string | null {
  try {
    const value = localStorage.getItem(LAST_DEPARTMENT_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

function saveLastDepartment(code: string): void {
  try {
    localStorage.setItem(LAST_DEPARTMENT_KEY, code);
  } catch {
    // ignore quota / private mode
  }
}

function WorkstationChrome({
  onEnterLobster,
  backendHealth,
  onRetryHealth,
  onCinematicHomeChange,
}: {
  onEnterLobster: () => void;
  backendHealth: HealthCheckResult | null;
  onRetryHealth: () => void;
  onCinematicHomeChange?: (isHome: boolean) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const llmConfigured = useWorkstationLlmConfigured();
  const openUserCenter = useUserCenterStore((s) => s.openUserCenter);
  const [llmGateOpen, setLlmGateOpen] = useState(false);
  const [llmGateForced, setLlmGateForced] = useState(false);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(() =>
    readLastDepartment(),
  );
  const [headerAuthTick, setHeaderAuthTick] = useState(0);
  const headerUser = useMemo(() => {
    void headerAuthTick;
    return loadUserProfile();
  }, [headerAuthTick]);
  const headerAvatarUrl = resolveAvatarDisplayUrl(headerUser?.avatarUrl);

  useEffect(() => {
    const bump = () => setHeaderAuthTick((n) => n + 1);
    window.addEventListener('workstation:credits-changed', bump);
    window.addEventListener('workstation:profile-changed', bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener('workstation:credits-changed', bump);
      window.removeEventListener('workstation:profile-changed', bump);
      window.removeEventListener('storage', bump);
    };
  }, []);

  useEffect(() => {
    if (location.pathname === '/' || location.pathname === '') {
      setSelectedDepartmentId(null);
    }
  }, [location.pathname]);

  const requireLogin = useCallback((): boolean => {
    if (getUserAccessToken() && loadUserProfile()) return true;
    openUserCenter('settings');
    return false;
  }, [openUserCenter]);

  useEffect(() => {
    const onRequest = () => {
      if (!requireLogin()) return;
      setLlmGateForced(needsWorkstationLlmKey());
      setLlmGateOpen(true);
    };
    window.addEventListener(WORKSTATION_LLM_KEY_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(WORKSTATION_LLM_KEY_REQUEST_EVENT, onRequest);
  }, [requireLogin]);

  const openLlmKeyEditor = useCallback(() => {
    if (!requireLogin()) return;
    // Missing key → force modal (no outside dismiss). Editing existing key → dismissible.
    setLlmGateForced(needsWorkstationLlmKey());
    setLlmGateOpen(true);
  }, [requireLogin]);

  const handleSelectDepartment = useCallback(
    (department: DepartmentAgent) => {
      if (!requireLogin()) return;
      if (needsWorkstationLlmKey()) {
        setLlmGateForced(true);
        setLlmGateOpen(true);
        return;
      }
      setSelectedDepartmentId(department.code);
      saveLastDepartment(department.code);
      navigate(`/templates/${department.code}`);
    },
    [navigate, requireLogin],
  );

  const handleBackHome = useCallback(() => {
    setSelectedDepartmentId(null);
    navigate('/');
  }, [navigate]);

  const handleEnterLobster = useCallback(() => {
    if (!requireLogin()) return;
    if (needsWorkstationLlmKey()) {
      setLlmGateForced(true);
      setLlmGateOpen(true);
      return;
    }
    onEnterLobster();
  }, [onEnterLobster, requireLogin]);

  const isCinematicHome =
    location.pathname === '/' || location.pathname === '';
  const isDepartmentWorkbench = location.pathname.startsWith('/templates/');
  const userCenterOpen = useUserCenterStore((s) => s.open);
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    onCinematicHomeChange?.(isCinematicHome);
  }, [isCinematicHome, onCinematicHomeChange]);

  return (
    <div
      className={cn(
        'workstation-root relative flex h-full min-h-0 w-full flex-col overflow-x-hidden bg-background text-foreground',
        isCinematicHome && 'workstation-root--cinematic-home',
        isDepartmentWorkbench && 'workstation-root--glass-workbench',
        userCenterOpen && 'uc-layout-pushed',
      )}
      data-product-mode="workstation"
      data-theme={theme}
    >
      {!isDepartmentWorkbench ? (
      <header
        className={cn(
          'flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4',
          isCinematicHome && 'cinematic-home-header absolute inset-x-0 top-0 z-50',
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <UserCenterTrigger
            title="打开用户中心"
            variant={isCinematicHome ? 'frost' : 'default'}
            avatarUrl={headerAvatarUrl}
          />
          <button
            type="button"
            className={cn(
              'flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight text-foreground hover:opacity-80',
              isCinematicHome && 'cinematic-brand',
            )}
            onClick={handleBackHome}
          >
            {isCinematicHome ? (
              <img
                src={brandMarkUrl}
                alt=""
                className="h-[34px] w-[34px] shrink-0 rounded-lg object-cover"
                draggable={false}
              />
            ) : null}
            <span className="truncate">火星 AI</span>
          </button>
          {selectedDepartmentId ? (
            <span className="truncate text-xs text-muted-foreground">
              {getDepartmentAgent(selectedDepartmentId)?.name ?? selectedDepartmentId}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={openLlmKeyEditor}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              isCinematicHome
                ? 'cinematic-cta-primary'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-200',
            )}
            title={llmConfigured ? '更换 API Key' : '登录后连接 API Key'}
          >
            连接高级智能体
          </button>
          <button
            type="button"
            className={cn(
              isCinematicHome ? 'cinematic-agent-entry' : 'lobster-jelly-cta',
            )}
            onClick={handleEnterLobster}
            aria-label="进入通用智能体"
          >
            {!isCinematicHome ? (
              <span className="lobster-jelly-cta__icon" aria-hidden>
                ✦
              </span>
            ) : (
              <span className="cinematic-agent-entry__plus" aria-hidden>
                +
              </span>
            )}
            <span>进入通用智能体</span>
          </button>
        </div>
      </header>
      ) : null}

      {backendHealth && !backendHealth.ok ? (
        <div
          className={cn(
            'flex shrink-0 items-start justify-between gap-3 border-b border-amber-500/30 bg-amber-50 px-4 py-2 text-amber-950 dark:bg-amber-950/40 dark:text-amber-50',
            isCinematicHome && 'relative z-40 mt-14',
            isDepartmentWorkbench && 'relative z-40',
          )}
          role="alert"
        >
          <div className="min-w-0 text-xs leading-relaxed">
            <div className="font-medium">工作站后端未就绪</div>
            <div className="mt-0.5 opacity-90">{backendHealth.message}</div>
            <div className="mt-0.5 opacity-70">
              对话仍可通过通用智能体进行；Excel/薪酬等确定性任务需要后端。
            </div>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md border border-amber-600/40 px-2 py-1 text-xs font-medium"
            onClick={onRetryHealth}
          >
            重试
          </button>
        </div>
      ) : null}

      <div
        className={cn(
          'uc-main-shift workstation-scroll min-h-0 flex-1 overflow-auto',
          isCinematicHome && !(backendHealth && !backendHealth.ok) && 'pt-14',
          isCinematicHome && 'overflow-hidden',
          isDepartmentWorkbench && 'overflow-hidden',
        )}
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              加载工作台…
            </div>
          }
        >
        <Routes>
          <Route
            path="/"
            element={<WorkstationHomePage onSelectDepartment={handleSelectDepartment} />}
          />
          <Route
            path="/templates/:departmentCode"
            element={
              <DepartmentWorkbenchRoute
                onEnter={setSelectedDepartmentId}
                onEnterLobster={handleEnterLobster}
              />
            }
          />
          <Route path="/production/workflows" element={<ProductionWorkflowHomePage />} />
          <Route path="/production/workflows/:workflowId" element={<ProductionWorkflowRunPage />} />
          <Route path="/hr/workflows" element={<HrWorkflowHomePage />} />
          <Route path="/hr/workflows/:workflowId" element={<HrWorkflowRunPage />} />
          <Route path="/finance/workflows" element={<FinanceWorkflowHomePage />} />
          <Route path="/finance/workflows/:workflowId" element={<FinanceWorkflowRunPage />} />
          <Route path="/ecommerce/workflows" element={<EcommerceWorkflowHomePage />} />
          <Route path="/ecommerce/workflows/:workflowId" element={<EcommerceWorkflowRunPage />} />
          <Route path="/logistics/workflows" element={<LogisticsWorkflowHomePage />} />
          <Route path="/logistics/workflows/:workflowId" element={<LogisticsWorkflowRunPage />} />
          <Route path="/admin/workflows" element={<AdminWorkflowHomePage />} />
          <Route path="/admin/workflows/:workflowId" element={<AdminWorkflowRunPage />} />
          <Route path="/production/material-daily-close" element={<MaterialDailyClosePage />} />
          <Route path="/production/close/:taskCode" element={<ProductionClosePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </div>

      <UserCenterDrawer />

      <WorkstationLlmKeyGate
        open={llmGateOpen}
        forced={llmGateForced}
        onOpenChange={setLlmGateOpen}
        onConfigured={() => {
          setLlmGateForced(false);
        }}
      />
    </div>
  );
}

function DepartmentWorkbenchRoute({
  onEnter,
  onEnterLobster,
}: {
  onEnter: (id: string) => void;
  onEnterLobster: () => void;
}) {
  const { departmentCode = '' } = useParams();
  useEffect(() => {
    if (departmentCode) {
      onEnter(departmentCode);
      saveLastDepartment(departmentCode);
    }
  }, [departmentCode, onEnter]);
  return <DepartmentWorkspacePage onEnterLobster={onEnterLobster} />;
}

/**
 * Root for productMode=workstation. Kept mounted (possibly hidden) by Lobster App.tsx
 * so internal navigation / department selection state is preserved.
 */
export function WorkstationApp({ onEnterLobster, onCinematicHomeChange }: WorkstationAppProps) {
  const [backendHealth, setBackendHealth] = useState<HealthCheckResult | null>(null);
  const [, setInternalView] = useState<InternalView>('home');

  const runHealthCheck = useCallback(() => {
    void healthCheck().then((result) => {
      setBackendHealth(result);
    });
  }, []);

  useEffect(() => {
    runHealthCheck();
    const timer = window.setInterval(runHealthCheck, 30_000);
    return () => window.clearInterval(timer);
  }, [runHealthCheck]);

  const initialEntries: string[] = useMemo(() => {
    const last = readLastDepartment();
    if (last && getDepartmentAgent(last)) {
      return [`/templates/${last}`];
    }
    return ['/'];
  }, []);

  const backendValue = useMemo(
    () => ({
      health: backendHealth,
      refresh: runHealthCheck,
    }),
    [backendHealth, runHealthCheck],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delayDuration={200}>
          <WorkstationBackendProvider value={backendValue}>
            <MemoryRouter initialEntries={initialEntries}>
              <WorkstationChrome
                onEnterLobster={() => {
                  setInternalView('home');
                  onEnterLobster();
                }}
                backendHealth={backendHealth}
                onRetryHealth={runHealthCheck}
                onCinematicHomeChange={onCinematicHomeChange}
              />
            </MemoryRouter>
          </WorkstationBackendProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default WorkstationApp;
