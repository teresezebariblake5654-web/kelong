import { useLocation } from 'react-router-dom';
import { PageNextButton } from '@workstation/components/layout/PageNextButton';
import { shouldShowPageNext } from '@workstation/lib/pageNavigation';
import { cn } from '@workstation/lib/utils';
import { useUiStore } from '@workstation/state/uiStore';

const floatingBtn =
  'pointer-events-auto size-9 rounded-lg bg-background/80 text-muted-foreground shadow-sm backdrop-blur hover:bg-muted hover:text-foreground';

/** 主区右上角：侧栏折叠时的下一步 */
export function TopRightControls() {
  const location = useLocation();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const showNext = shouldShowPageNext(location.pathname);

  if (!collapsed || !showNext) return null;

  return (
    <div className="pointer-events-none absolute top-3 right-3 z-40">
      <PageNextButton className={cn(floatingBtn, 'pointer-events-auto')} />
    </div>
  );
}
