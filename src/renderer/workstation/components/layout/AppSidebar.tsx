import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FolderOpen,
  Flower2,
  Gauge,
  HelpCircle,
  LayoutTemplate,
  LogOut,
  MessageSquarePlus,
  PanelLeft,
  PanelLeftClose,
  UserRound,
  WalletCards,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ConversationList } from '@workstation/components/chat/ConversationList';
import { Button } from '@workstation/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@workstation/components/ui/tooltip';
import { loadUserProfile, loadWorkspace } from '@workstation/lib/localStore';
import { cn } from '@workstation/lib/utils';
import { authSessionService } from '@workstation/services/authSession.service';
import { useChatStore } from '@workstation/state/chatStore';
import { useTemplateSessionStore } from '@workstation/state/templateSessionStore';
import { useUiStore } from '@workstation/state/uiStore';

const SIDE_LINKS = [
  { path: '/templates', label: '工作智能体', icon: LayoutTemplate },
  { path: '/quota', label: '额度消耗', icon: Gauge },
  { path: '/files', label: '文件库', icon: FolderOpen },
] as const;

const ACCOUNT_MENU_ITEMS = [
  { path: '/account', label: '账户信息', icon: UserRound },
  { path: '/account/credits', label: '分析额度', icon: WalletCards },
  { path: '/account/help', label: '帮助与支持', icon: HelpCircle },
] as const;

function initialsFromName(name: string): string {
  const text = name.trim();
  if (!text || text === '未登录') return '?';
  if (/[\u4e00-\u9fff]/.test(text)) return text.slice(0, 1);
  const parts = text.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
  return text.slice(0, 2).toUpperCase();
}

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUiStore((s) => s.setSidebarCollapsed);

  const selectedAgentCode = useChatStore((s) => s.selectedAgentCode);
  const prepareNewChat = useChatStore((s) => s.prepareNewChat);
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const setConversationTitle = useChatStore((s) => s.setConversationTitle);
  const resetCurrentTemplate = useTemplateSessionStore((s) => s.resetCurrentTemplate);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number; width: number } | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const user = loadUserProfile();
  const workspace = loadWorkspace();
  const displayName =
    user?.username?.trim() ||
    (user?.email?.includes('@') ? user.email.split('@')[0] : null) ||
    workspace.organizationName ||
    '未登录';
  const emailLabel = user?.email?.trim() || workspace.organizationName || '本地演示账号';
  const planLabel =
    user?.role === 'super_admin' || user?.role === 'admin'
      ? '企业管理员'
      : workspace.organizationName
        ? '企业版'
        : '免费版';
  const avatarInitials = initialsFromName(displayName);

  useLayoutEffect(() => {
    if (!menuOpen || !triggerRef.current) {
      setMenuPos(null);
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 8,
      width: Math.max(rect.width, 220),
    });
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const onResize = () => setMenuOpen(false);

    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', onPointerDown);
    }, 0);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [menuOpen]);

  const goNewChat = () => {
    prepareNewChat(selectedAgentCode);
    if (location.pathname !== '/chat') navigate('/chat');
  };

  const goAccount = (path: string) => {
    setMenuOpen(false);
    navigate(path);
  };

  const onLogout = () => {
    authSessionService.logout();
    resetCurrentTemplate();
    setMenuOpen(false);
    navigate('/login', { replace: true });
  };

  if (collapsed) return null;

  const isTemplatesActive =
    location.pathname === '/templates' || location.pathname.startsWith('/templates/');

  const accountMenu =
    menuOpen && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[80] overflow-hidden rounded-2xl border border-slate-200/90 bg-white text-slate-700 shadow-[0_16px_40px_-16px_rgba(15,23,42,0.55)]"
            style={{
              left: menuPos.left,
              bottom: menuPos.bottom,
              width: menuPos.width,
            }}
            role="menu"
          >
            <div className="border-b border-slate-100 px-3.5 py-3">
              <div className="truncate text-sm font-medium text-slate-900">{displayName}</div>
              <div className="mt-0.5 truncate text-xs text-slate-400">{emailLabel}</div>
            </div>
            <div className="flex flex-col p-1.5">
              {ACCOUNT_MENU_ITEMS.map((item) => {
                const Icon = item.icon;
                const active =
                  item.path === '/account'
                    ? location.pathname === '/account'
                    : location.pathname.startsWith(item.path);
                return (
                  <button
                    key={item.path}
                    type="button"
                    role="menuitem"
                    className={cn(
                      'flex h-10 items-center gap-2.5 rounded-xl px-2.5 text-sm hover:bg-slate-50',
                      active ? 'bg-[#EAF2FB] font-medium text-[#3A6EA5]' : 'text-slate-700',
                    )}
                    onClick={() => goAccount(item.path)}
                  >
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        active ? 'text-[#6B9BD1]' : 'text-slate-400',
                      )}
                    />
                    {item.label}
                  </button>
                );
              })}
              <div className="my-1 border-t border-slate-100" />
              <button
                type="button"
                role="menuitem"
                className="flex h-10 items-center gap-2.5 rounded-xl px-2.5 text-sm text-slate-700 hover:bg-slate-50"
                onClick={onLogout}
              >
                <LogOut className="size-4 shrink-0 text-slate-400" />
                退出登录
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <aside className="relative z-30 flex h-full w-[268px] shrink-0 flex-col overflow-hidden border-r border-[#E6EEF6] bg-[#F5F8FC] text-slate-700">
      <div className="flex items-center gap-1 px-3 pt-4 pb-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-white/80"
          onClick={goNewChat}
          title="智力魔盒"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-[#EEF5FF] text-[#3B82F6] shadow-sm ring-1 ring-[#D6E6FF]">
            <Flower2 className="size-4" strokeWidth={2} />
          </span>
          <span className="truncate text-[15px] font-semibold tracking-tight text-slate-800">
            智力魔盒
          </span>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-slate-400 hover:bg-white hover:text-slate-700"
              onClick={() => setSidebarCollapsed(true)}
              aria-label="关闭侧边栏"
            >
              <PanelLeftClose className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">关闭侧边栏</TooltipContent>
        </Tooltip>
      </div>

      <div className="px-3 pb-2 pt-2">
        <button
          type="button"
          className="flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-[#3B82F6] text-sm font-semibold text-white shadow-[0_10px_24px_-12px_rgba(59,130,246,0.7)] transition hover:bg-[#2563EB]"
          onClick={goNewChat}
        >
          <MessageSquarePlus className="size-4 shrink-0" />
          新建对话
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 px-3 pb-2">
        {SIDE_LINKS.map((item) => {
          const active =
            item.path === '/templates'
              ? isTemplatesActive
              : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              type="button"
              className={cn(
                'relative flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-sm transition-colors',
                active
                  ? 'bg-[#EAF2FB] font-medium text-[#3A6EA5]'
                  : 'text-slate-500 hover:bg-white hover:text-slate-800',
              )}
              onClick={() => navigate(item.path)}
            >
              {active ? (
                <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-[#7BA4D4]" />
              ) : null}
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mx-3 mb-1 mt-1 border-t border-[#E2EAF3]" />
      <div className="px-4 pb-1 pt-1 text-[11px] font-medium tracking-wide text-slate-400">
        历史对话
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-1.5 pb-2">
        <ConversationList
          conversations={conversations}
          activeConversationId={location.pathname === '/chat' ? activeConversationId : null}
          highlightActive={location.pathname === '/chat'}
          className="h-full"
          onSelect={(id) => {
            selectConversation(id);
            if (location.pathname !== '/chat') navigate('/chat');
          }}
          onDelete={deleteConversation}
          onRename={setConversationTitle}
        />
      </div>

      <div className="relative shrink-0 border-t border-[#E6EEF6] p-2">
        {accountMenu}
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-2xl px-2 py-2 text-left transition-colors',
            menuOpen ? 'bg-white shadow-sm' : 'hover:bg-white/90',
          )}
          onClick={() => setMenuOpen((open) => !open)}
          onDoubleClick={() => goAccount('/account')}
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#8FBC8F] to-[#5F9EA0] text-[11px] font-semibold text-white shadow-sm"
            aria-hidden
          >
            {avatarInitials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-800">{displayName}</span>
            <span className="mt-0.5 block truncate text-[11px] text-slate-400">{planLabel}</span>
          </span>
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-md text-slate-300 transition-transform',
              menuOpen && 'rotate-180 text-slate-500',
            )}
            aria-hidden
          >
            <svg viewBox="0 0 16 16" className="size-3.5 fill-current" aria-hidden>
              <path d="M4.47 6.22a.75.75 0 0 1 1.06 0L8 8.69l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </span>
        </button>
      </div>
    </aside>
  );
}

/** ChatGPT 风格：侧栏关闭后，主区左上角显示打开侧栏 / 新建对话 */
export function SidebarOpenControls() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const navigate = useNavigate();
  const location = useLocation();
  const selectedAgentCode = useChatStore((s) => s.selectedAgentCode);
  const prepareNewChat = useChatStore((s) => s.prepareNewChat);

  if (!collapsed) return null;

  const goNewChat = () => {
    prepareNewChat(selectedAgentCode);
    if (location.pathname !== '/chat') navigate('/chat');
  };

  return (
    <div className="pointer-events-none absolute top-3 left-3 z-40 flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="pointer-events-auto size-9 rounded-lg bg-background/80 text-muted-foreground shadow-sm backdrop-blur hover:bg-muted hover:text-foreground"
            onClick={() => setSidebarCollapsed(false)}
            aria-label="打开侧边栏"
          >
            <PanelLeft className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">打开侧边栏</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="pointer-events-auto size-9 rounded-lg bg-background/80 text-muted-foreground shadow-sm backdrop-blur hover:bg-muted hover:text-foreground"
            onClick={goNewChat}
            aria-label="新建对话"
          >
            <MessageSquarePlus className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">新建对话</TooltipContent>
      </Tooltip>
    </div>
  );
}
