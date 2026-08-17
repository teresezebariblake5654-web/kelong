import { Check, Plus } from 'lucide-react';
import type { AgentWorkMode } from '@workstation/data/agentConfigs';
import { cn } from '@workstation/lib/utils';

type WorkModePanelProps = {
  modes: AgentWorkMode[];
  /** 空字符串表示未锁定技能（自由对话） */
  selectedId: string;
  accent: string;
  accentSoft: string;
  /** 再次点击已选技能 = 取消（由父级处理） */
  onSelect: (mode: AgentWorkMode | null) => void;
  /** 工作模式顶部「新建对话」 */
  onNewChat?: () => void;
  className?: string;
};

export function WorkModePanel({
  modes,
  selectedId,
  accent,
  accentSoft,
  onSelect,
  onNewChat,
  className,
}: WorkModePanelProps) {
  return (
    <section
      className={cn(
        'apple-glass flex max-h-[48%] min-h-[220px] shrink-0 flex-col overflow-hidden rounded-[22px]',
        className,
      )}
    >
      <div className="shrink-0 px-4 pb-2 pt-3.5">
        <h3 className="text-[13px] font-semibold tracking-tight text-slate-800">工作模式</h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
          点选后主区出现提示词；上传表格后直接在聊天里分析出表
        </p>
      </div>

      <div
        className={cn(
          'min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3',
          '[&::-webkit-scrollbar]:w-1',
          '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300/60',
        )}
      >
        <button
          type="button"
          onClick={() => onNewChat?.()}
          className="group relative flex w-full items-start gap-2.5 rounded-[14px] border border-transparent p-2.5 text-left transition-all hover:bg-white/55"
        >
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-[11px]"
            style={{ background: `${accent}18`, color: accent }}
          >
            <Plus className="size-4" strokeWidth={2.25} />
          </span>

          <div className="min-w-0 flex-1 pr-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12.5px] font-semibold text-slate-800">新建对话</span>
              <span
                className="rounded-full px-1.5 py-0.5 text-[9px] font-medium text-white"
                style={{ background: accent }}
              >
                快捷
              </span>
            </div>
            <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">
              保存当前会话，开始空白对话
            </p>
          </div>
        </button>

        {modes.map((mode) => {
          const selected = mode.id === selectedId;
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => onSelect(selected ? null : mode)}
              className={cn(
                'group relative flex w-full items-start gap-2.5 rounded-[14px] border p-2.5 text-left transition-all',
                selected
                  ? 'border-white/80 bg-white/75 shadow-sm'
                  : 'border-transparent hover:bg-white/55',
              )}
              style={
                selected
                  ? { boxShadow: `0 0 0 1px ${accentSoft}, 0 8px 24px -16px ${accent}` }
                  : undefined
              }
            >
              <span
                className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[11px] text-[11px] font-semibold"
                style={{
                  background: selected ? accent : `${accent}18`,
                  color: selected ? '#fff' : accent,
                }}
              >
                {selected ? <Check className="size-4" strokeWidth={2.5} /> : mode.name.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12.5px] font-semibold text-slate-800">{mode.name}</span>
                  {mode.templateCode ? (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
                      聊天出表
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{mode.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
