import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { WorkflowMode } from '@workstation/data/departmentAgents';
import { cn } from '@workstation/lib/utils';

type WorkflowModeSelectorProps = {
  modes: WorkflowMode[];
  value: string;
  onChange: (templateCode: string) => void;
  disabled?: boolean;
};

/** Cursor 风格：输入框旁的工作模式下拉选择器 */
export function WorkflowModeSelector({
  modes,
  value,
  onChange,
  disabled,
}: WorkflowModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = modes.find((item) => item.templateCode === value) ?? modes[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  if (!current) return null;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        disabled={disabled || modes.length === 0}
        className={cn(
          'inline-flex max-w-[220px] items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors',
          'hover:bg-muted/70 hover:text-foreground disabled:opacity-50',
        )}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate font-medium text-foreground">{current.name}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <WorkflowModeDropdown
          modes={modes}
          value={current.templateCode}
          onSelect={(code) => {
            onChange(code);
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function WorkflowModeDropdown({
  modes,
  value,
  onSelect,
}: {
  modes: WorkflowMode[];
  value: string;
  onSelect: (templateCode: string) => void;
}) {
  return (
    <div
      role="listbox"
      className="absolute bottom-[calc(100%+8px)] right-0 z-50 w-[280px] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
    >
      <div className="border-b border-border px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground">
        工作模式
      </div>
      <div className="max-h-64 overflow-y-auto p-1">
        {modes.map((mode) => {
          const active = mode.templateCode === value;
          return (
            <button
              key={mode.templateCode}
              type="button"
              role="option"
              aria-selected={active}
              className={cn(
                'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                active ? 'bg-muted' : 'hover:bg-muted/70',
              )}
              onClick={() => onSelect(mode.templateCode)}
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {active ? <Check className="size-3.5 text-foreground" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{mode.name}</span>
                <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted-foreground">
                  {mode.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { WorkflowModeDropdown };
