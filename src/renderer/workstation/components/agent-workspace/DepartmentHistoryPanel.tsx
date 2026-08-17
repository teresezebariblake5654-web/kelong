import { Eraser, MessageSquareText, Plus, Trash2 } from 'lucide-react';
import type { DepartmentChatHistoryItem } from '@workstation/lib/departmentChatStore';
import { formatDepartmentHistoryTime } from '@workstation/lib/departmentChatStore';
import { cn } from '@workstation/lib/utils';

type DepartmentHistoryPanelProps = {
  items: DepartmentChatHistoryItem[];
  activeId: string | null;
  accent: string;
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
  onClearAll: () => void;
  onDelete?: (conversationId: string) => void;
  className?: string;
};

export function DepartmentHistoryPanel({
  items,
  activeId,
  accent,
  onSelect,
  onNewChat,
  onClearAll,
  onDelete,
  className,
}: DepartmentHistoryPanelProps) {
  return (
    <section
      className={cn(
        'apple-glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px]',
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3.5">
        <h3 className="text-[13px] font-semibold tracking-tight text-slate-800">历史记录</h3>
        <span className="rounded-full bg-slate-900/5 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
          {items.length}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onNewChat}
            className="inline-flex size-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/70 hover:text-slate-800"
            title="新建对话"
            aria-label="新建对话"
          >
            <Plus className="size-3.5" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            onClick={onClearAll}
            disabled={!items.length}
            className="inline-flex size-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/70 hover:text-rose-500 disabled:opacity-30"
            title="清空本岗位历史"
            aria-label="清空本岗位历史"
          >
            <Eraser className="size-3.5" />
          </button>
        </div>
      </div>

      <div
        className={cn(
          'min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3',
          '[&::-webkit-scrollbar]:w-1',
          '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300/60',
        )}
      >
        {!items.length ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <span
              className="flex size-10 items-center justify-center rounded-2xl"
              style={{ background: `${accent}18`, color: accent }}
            >
              <MessageSquareText className="size-5" />
            </span>
            <p className="text-xs leading-relaxed text-slate-500">
              本岗位还没有历史对话。
              <br />
              发一条消息后会按岗位线程自动存档（各对话互不串记忆）。
            </p>
          </div>
        ) : (
          items.map((item) => {
            const active = item.conversationId === activeId;
            return (
              <div
                key={item.conversationId}
                className={cn(
                  'group relative rounded-[14px] border transition-all',
                  active
                    ? 'border-transparent shadow-[0_8px_20px_-16px_rgba(15,23,42,0.35)]'
                    : 'border-transparent hover:border-white/80 hover:bg-white/55',
                )}
                style={
                  active
                    ? {
                        background: `linear-gradient(135deg, ${accent}22, rgba(255,255,255,0.72))`,
                        boxShadow: `0 0 0 1px ${accent}33`,
                      }
                    : undefined
                }
              >
                <button
                  type="button"
                  onClick={() => onSelect(item.conversationId)}
                  className="w-full px-3 py-2.5 text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-1 text-[12.5px] font-semibold text-slate-800">
                      {item.title}
                    </span>
                    <span className="shrink-0 pt-0.5 text-[10px] text-slate-400">
                      {formatDepartmentHistoryTime(item.updatedAt)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
                    {item.preview}
                  </p>
                </button>
                {onDelete ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(item.conversationId);
                    }}
                    className="absolute bottom-2 right-2 inline-flex size-6 items-center justify-center rounded-full text-slate-300 opacity-0 transition group-hover:opacity-100 hover:bg-white hover:text-rose-500"
                    title="删除这段对话"
                    aria-label="删除这段对话"
                  >
                    <Trash2 className="size-3" />
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
