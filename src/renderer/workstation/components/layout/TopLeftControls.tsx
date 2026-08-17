import { MessageSquarePlus, PanelLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageBackButton } from '@workstation/components/layout/PageBackButton';
import { Button } from '@workstation/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@workstation/components/ui/tooltip';
import { shouldShowPageBack } from '@workstation/lib/pageNavigation';
import { cn } from '@workstation/lib/utils';
import { useChatStore } from '@workstation/state/chatStore';
import { useUiStore } from '@workstation/state/uiStore';

const floatingBtn =
  'pointer-events-auto size-9 rounded-lg bg-background/80 text-muted-foreground shadow-sm backdrop-blur hover:bg-muted hover:text-foreground';

/** 主区左上角：侧栏折叠时的返回 + 打开侧栏 + 新建对话 */
export function TopLeftControls() {
  const location = useLocation();
  const navigate = useNavigate();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const selectedAgentCode = useChatStore((s) => s.selectedAgentCode);
  const prepareNewChat = useChatStore((s) => s.prepareNewChat);

  const showBack = shouldShowPageBack(location.pathname);
  const showNewChat =
    collapsed &&
    (location.pathname === '/chat' || /^\/templates\/[^/]+$/.test(location.pathname));

  if (!collapsed) return null;

  const goNewChat = () => {
    prepareNewChat(selectedAgentCode);
    if (location.pathname !== '/chat') navigate('/chat');
  };

  return (
    <div className="pointer-events-none absolute top-3 left-3 z-40 flex items-center gap-1">
      {showBack ? <PageBackButton className={cn(floatingBtn, 'pointer-events-auto')} /> : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={floatingBtn}
            onClick={() => setSidebarCollapsed(false)}
            aria-label="打开侧边栏"
          >
            <PanelLeft className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">打开侧边栏</TooltipContent>
      </Tooltip>
      {showNewChat ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={floatingBtn}
              onClick={goNewChat}
              aria-label="新建对话"
            >
              <MessageSquarePlus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">新建对话</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
