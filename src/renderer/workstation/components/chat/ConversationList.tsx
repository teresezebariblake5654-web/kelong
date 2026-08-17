import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  MoreHorizontal,
  Pencil,
  Pin,
  Share2,
  Trash2,
} from 'lucide-react';
import type { Conversation } from '@aw/shared';
import { Button } from '@workstation/components/ui/button';
import { cn } from '@workstation/lib/utils';

const PINNED_KEY = 'aw.desktop.pinnedChats';
const ARCHIVED_KEY = 'aw.desktop.archivedChats';

type ConversationListProps = {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  className?: string;
  highlightActive?: boolean;
};

function loadPinnedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function savePinnedIds(ids: Set<string>) {
  localStorage.setItem(PINNED_KEY, JSON.stringify([...ids]));
}

function loadArchivedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(ARCHIVED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveArchivedIds(ids: Set<string>) {
  localStorage.setItem(ARCHIVED_KEY, JSON.stringify([...ids]));
}

type MenuItemProps = {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
};

function MenuItem({ icon, label, danger, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[13px] transition-colors',
        danger
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-muted/80',
      )}
      onClick={onClick}
    >
      <span
        className={cn(
          'flex size-[18px] shrink-0 items-center justify-center',
          danger ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {icon}
      </span>
      {label}
    </button>
  );
}

type ConversationRowProps = {
  conversation: Conversation;
  active: boolean;
  pinned: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onArchive: () => void;
  isMenuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
};

function ConversationRow({
  conversation,
  active,
  pinned,
  onSelect,
  onDelete,
  onRename,
  onTogglePin,
  onArchive,
  isMenuOpen,
  onMenuOpenChange,
}: ConversationRowProps) {
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversation.title);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!isMenuOpen) return;
    const rect = menuButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 220;
    const menuHeight = confirmDelete ? 120 : 240;
    let top = rect.top;
    let left = rect.right + 8;
    if (left + menuWidth > window.innerWidth - 12) {
      left = Math.max(12, rect.left - menuWidth - 8);
    }
    if (top + menuHeight > window.innerHeight - 12) {
      top = Math.max(12, window.innerHeight - menuHeight - 12);
    }
    setMenuPos({ top, left });
  }, [confirmDelete, isMenuOpen]);

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  useEffect(() => {
    setDraftTitle(conversation.title);
  }, [conversation.title]);

  const closeMenu = useCallback(() => {
    onMenuOpenChange(false);
    setConfirmDelete(false);
  }, [onMenuOpenChange]);

  const startRename = useCallback(() => {
    closeMenu();
    setRenaming(true);
    setDraftTitle(conversation.title);
  }, [closeMenu, conversation.title]);

  const commitRename = useCallback(() => {
    const next = draftTitle.trim();
    if (next && next !== conversation.title) onRename(next);
    setRenaming(false);
  }, [conversation.title, draftTitle, onRename]);

  const openMenu = useCallback(() => {
    const rect = menuButtonRef.current?.getBoundingClientRect();
    if (rect) {
      const menuWidth = 220;
      const menuHeight = confirmDelete ? 120 : 240;
      let top = rect.top;
      let left = rect.right + 8;
      if (left + menuWidth > window.innerWidth - 12) {
        left = Math.max(12, rect.left - menuWidth - 8);
      }
      if (top + menuHeight > window.innerHeight - 12) {
        top = Math.max(12, window.innerHeight - menuHeight - 12);
      }
      setMenuPos({ top, left });
    }
    onMenuOpenChange(true);
  }, [confirmDelete, onMenuOpenChange]);

  const handleShare = useCallback(async () => {
    closeMenu();
    const text = `智力魔盒对话：${conversation.title}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }, [closeMenu, conversation.title]);

  return (
    <div
      className={cn(
        'group relative flex items-center gap-1 rounded-xl px-2.5 py-2 transition-colors',
        active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/80',
        isMenuOpen && 'bg-sidebar-accent',
      )}
    >
      {renaming ? (
        <input
          ref={inputRef}
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitRename();
            if (event.key === 'Escape') {
              setDraftTitle(conversation.title);
              setRenaming(false);
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none ring-0 focus-visible:border-primary"
        />
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-sm leading-6 text-sidebar-foreground"
          onClick={onSelect}
          title={conversation.title}
        >
          {conversation.title}
        </button>
      )}

      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5',
          active || isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        {pinned ? (
          <span className="flex size-7 items-center justify-center text-sidebar-muted" aria-hidden>
            <Pin className="size-3.5 rotate-45" />
          </span>
        ) : null}
        <Button
          ref={menuButtonRef}
          variant="ghost"
          size="icon"
          className="size-7 rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          aria-label="更多操作"
          aria-expanded={isMenuOpen}
          data-conversation-menu-trigger
          onClick={(event) => {
            event.stopPropagation();
            if (isMenuOpen) {
              closeMenu();
            } else {
              openMenu();
            }
          }}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </div>

      {isMenuOpen
        ? createPortal(
            <div
              className="fixed z-[200] w-[220px] animate-in fade-in-0 zoom-in-95 overflow-hidden rounded-xl border border-border/80 bg-popover text-popover-foreground shadow-[0_12px_40px_rgba(0,0,0,0.14)] duration-150"
              style={{ top: menuPos.top, left: menuPos.left }}
              data-conversation-menu
              onClick={(event) => event.stopPropagation()}
            >
              {confirmDelete ? (
                <div className="p-3">
                  <p className="text-sm font-medium text-foreground">删除聊天？</p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 flex-1 rounded-lg text-[13px] font-normal"
                      onClick={() => setConfirmDelete(false)}
                    >
                      取消
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-9 flex-1 rounded-lg text-[13px] font-normal"
                      onClick={() => {
                        onDelete();
                        closeMenu();
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="p-1.5">
                  <MenuItem icon={<Share2 className="size-[18px]" />} label="分享" onClick={handleShare} />
                  <MenuItem icon={<Pencil className="size-[18px]" />} label="重命名" onClick={startRename} />
                  <MenuItem
                    icon={<Pin className="size-[18px]" />}
                    label={pinned ? '取消置顶' : '置顶聊天'}
                    onClick={() => {
                      onTogglePin();
                      closeMenu();
                    }}
                  />
                  <MenuItem
                    icon={<Archive className="size-[18px]" />}
                    label="归档"
                    onClick={() => {
                      onArchive();
                      closeMenu();
                    }}
                  />
                  <div className="my-1 h-px bg-border/80" />
                  <MenuItem
                    icon={<Trash2 className="size-[18px]" />}
                    label="删除"
                    danger
                    onClick={() => setConfirmDelete(true)}
                  />
                </div>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** 侧栏对话历史：ChatGPT 风格 ⋯ 菜单 + 删除二次确认 */
export function ConversationList({
  conversations,
  activeConversationId,
  onSelect,
  onDelete,
  onRename,
  className,
  highlightActive = true,
}: ConversationListProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => loadPinnedIds());
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => loadArchivedIds());
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenuId) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-conversation-menu]')) return;
      if (target.closest('[data-conversation-menu-trigger]')) return;
      setOpenMenuId(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [openMenuId]);

  const sorted = [...conversations]
    .filter((item) => !archivedIds.has(item.id))
    .sort((a, b) => {
      const aPinned = pinnedIds.has(a.id);
      const bPinned = pinnedIds.has(b.id);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  const togglePin = (id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      savePinnedIds(next);
      return next;
    });
  };

  const archiveConversation = (id: string) => {
    setArchivedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveArchivedIds(next);
      return next;
    });
    if (openMenuId === id) setOpenMenuId(null);
  };

  return (
    <div
      ref={listRef}
      className={cn(
        'min-h-0 flex-1 overflow-y-auto overflow-x-visible overscroll-contain px-2 pb-2',
        '[&::-webkit-scrollbar]:w-1.5',
        '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-sidebar-border',
        '[&::-webkit-scrollbar-track]:bg-transparent',
        className,
      )}
    >
      <div className="flex flex-col gap-0.5 pr-1">
        {sorted.length ? (
          sorted.map((conversation) => {
            const active = highlightActive && conversation.id === activeConversationId;
            return (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                active={active}
                pinned={pinnedIds.has(conversation.id)}
                onSelect={() => {
                  setOpenMenuId(null);
                  onSelect(conversation.id);
                }}
                onDelete={() => onDelete(conversation.id)}
                onRename={(title) => onRename?.(conversation.id, title)}
                onTogglePin={() => togglePin(conversation.id)}
                onArchive={() => archiveConversation(conversation.id)}
                isMenuOpen={openMenuId === conversation.id}
                onMenuOpenChange={(open) => setOpenMenuId(open ? conversation.id : null)}
              />
            );
          })
        ) : (
          <div className="px-2 py-3 text-xs text-sidebar-muted">暂无历史对话</div>
        )}
      </div>
    </div>
  );
}
