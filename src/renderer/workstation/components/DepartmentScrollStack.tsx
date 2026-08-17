import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { DepartmentAgent } from '@workstation/data/departmentAgents';
import { PUBLISHED_DEPARTMENT_AGENTS } from '@workstation/data/departmentAgents';
import { getAgentConfig } from '@workstation/data/agentConfigs';
import { DepartmentIcon } from '@workstation/components/departments/DepartmentIcon';
import { cn } from '@workstation/lib/utils';
import '@workstation/components/departments/departmentIcons.css';

/** Homepage focus list — keep in sync with PUBLISHED_AGENT_CODES */
const USER_FOCUS_CODES = [
  'hr',
  'finance',
  'ecommerce',
  'administration',
] as const;

const SLIDE_MS = 320;

function getDepartmentModeLabels(department: DepartmentAgent): string[] {
  const fromConfig = getAgentConfig(department.code)?.workModes.map((m) => m.name) ?? [];
  if (fromConfig.length) return fromConfig;
  return department.workflows.map((m) => m.name);
}

export function getScrollStackDepartments(
  agents: DepartmentAgent[] = PUBLISHED_DEPARTMENT_AGENTS,
): DepartmentAgent[] {
  const allowed = new Set<string>(USER_FOCUS_CODES);
  const focused = agents.filter((item) => allowed.has(item.code));
  return focused.length > 0 ? focused : agents;
}

type DepartmentScrollStackProps = {
  departments?: DepartmentAgent[];
  onSelect: (department: DepartmentAgent) => void;
  className?: string;
  cinematic?: boolean;
};

/**
 * Vertical-only agent card pager.
 * One card visible at a time; wheel / touch / dots slide up-down.
 */
export function DepartmentScrollStack({
  departments: departmentsProp,
  onSelect,
  className,
  cinematic = false,
}: DepartmentScrollStackProps) {
  const departments = useMemo(
    () => departmentsProp ?? getScrollStackDepartments(),
    [departmentsProp],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const lockUntil = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);

  const total = departments.length;
  const active = departments[activeIndex] ?? departments[0];

  const goTo = useCallback(
    (nextIndex: number, dir?: 1 | -1) => {
      if (total === 0) return;
      const wrapped = ((nextIndex % total) + total) % total;
      if (wrapped === activeIndex) return;
      const now = performance.now();
      if (now < lockUntil.current) return;
      lockUntil.current = now + SLIDE_MS + 40;
      setDirection(dir ?? (wrapped > activeIndex ? 1 : -1));
      setActiveIndex(wrapped);
    },
    [activeIndex, total],
  );

  const goBy = useCallback(
    (delta: 1 | -1) => {
      if (total === 0) return;
      goTo((activeIndex + delta + total) % total, delta);
    },
    [activeIndex, goTo, total],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root || total === 0) return;

    const onWheel = (event: WheelEvent) => {
      // Vertical only — ignore horizontal trackpad drift
      if (Math.abs(event.deltaY) < 10) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      event.stopPropagation();
      goBy(event.deltaY > 0 ? 1 : -1);
    };

    let touchStartY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? null;
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (touchStartY == null) return;
      const startY = touchStartY;
      const endY = event.changedTouches[0]?.clientY;
      touchStartY = null;
      if (endY == null) return;
      const dy = startY - endY;
      if (Math.abs(dy) < 48) return;
      goBy(dy > 0 ? 1 : -1);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        goBy(1);
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        goBy(-1);
      }
    };

    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('keydown', onKeyDown);

    return () => {
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [goBy, total]);

  if (!active) return null;

  const modeLabels = getDepartmentModeLabels(active);
  const modeCount = modeLabels.length || active.workflows.length;

  const variants = {
    enter: (dir: 1 | -1) => ({
      y: dir > 0 ? 72 : -72,
      opacity: 0,
    }),
    center: {
      y: 0,
      opacity: 1,
    },
    exit: (dir: 1 | -1) => ({
      y: dir > 0 ? -72 : 72,
      opacity: 0,
    }),
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative mx-auto flex w-full max-w-2xl flex-col',
        cinematic ? 'max-w-xl' : 'min-h-[78vh]',
        className,
      )}
      data-testid="department-scroll-stack"
    >
      {!cinematic ? (
        <div className="pointer-events-none mb-8 shrink-0 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">AI员工助手</h1>
          <p className="mt-2 text-sm text-muted-foreground">上下滑动切换部门 · 点击进入工作台</p>
        </div>
      ) : (
        <div className="mb-4 flex shrink-0 flex-wrap items-center justify-center gap-2">
          {departments.map((department, index) => (
            <button
              key={department.code}
              type="button"
              onClick={() => goTo(index, index > activeIndex ? 1 : -1)}
              className={cn(
                'font-body cinematic-dept-tab',
                index === activeIndex && 'is-active',
              )}
              aria-current={index === activeIndex ? 'true' : undefined}
            >
              {department.name}
            </button>
          ))}
        </div>
      )}

      <div
        className={cn(
          'relative mx-auto w-full max-w-lg shrink-0 overflow-hidden',
          cinematic ? 'h-[300px] sm:h-[320px]' : 'h-[440px]',
        )}
      >
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.button
            key={active.code}
            type="button"
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: SLIDE_MS / 1000, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'absolute inset-x-0 top-0 flex w-full flex-col overflow-hidden text-left',
              cinematic
                ? 'cinematic-dept-card liquid-glass-strong h-[280px] rounded-[1.5rem] p-5 sm:h-[300px] sm:p-6'
                : cn(
                    'h-[400px] rounded-[28px] border border-black/5 p-8',
                    'shadow-[0_16px_40px_-20px_rgba(15,23,42,0.32)]',
                  ),
            )}
            style={
              cinematic
                ? undefined
                : {
                    background: `linear-gradient(155deg, ${active.theme.from} 0%, ${active.theme.to} 100%)`,
                  }
            }
            onClick={() => onSelect(active)}
          >
            {cinematic ? (
              <>
                <div className="relative z-[1] mb-4 flex items-start justify-between gap-3">
                  <span className="cinematic-dept-icon liquid-glass flex size-11 shrink-0 items-center justify-center rounded-2xl">
                    <DepartmentIcon code={active.icon} animated className="scale-110" />
                  </span>
                  <div className="flex max-w-[72%] flex-wrap justify-end gap-1.5">
                    {modeLabels.slice(0, 4).map((label) => (
                      <span
                        key={label}
                        className="liquid-glass whitespace-nowrap rounded-full px-2.5 py-1 font-body text-[10px] tracking-wide text-white/90"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="relative z-[1] flex-1" />
                <h3 className="relative z-[1] font-heading text-3xl leading-none tracking-[-1px] text-white">
                  {active.name}
                </h3>
                <p className="relative z-[1] mt-2.5 max-w-[36ch] font-body text-sm font-light leading-snug text-white/88">
                  {active.description}
                </p>
                <div className="relative z-[1] mt-4 font-body text-xs font-medium tracking-wide text-white/65">
                  {modeCount} 个工作模式 · 点击卡片进入
                </div>
              </>
            ) : (
              <>
                <span
                  className="mb-6 flex size-16 items-center justify-center rounded-[18px] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_10px_20px_-8px_rgba(15,23,42,0.35)]"
                  style={{ background: active.theme.iconBg }}
                >
                  <DepartmentIcon code={active.icon} animated className="scale-125 text-white" />
                </span>
                <div className="text-[22px] font-semibold tracking-tight text-foreground">
                  {active.name}
                </div>
                <p className="mt-3 line-clamp-4 text-[15px] leading-relaxed text-muted-foreground">
                  {active.description}
                </p>
                <div
                  className="mt-auto pt-6 text-xs font-medium"
                  style={{ color: active.theme.accent }}
                >
                  {modeCount} 个工作模式 · 点进工作站后选模式开聊
                </div>
              </>
            )}
          </motion.button>
        </AnimatePresence>
      </div>

      <div
        className={cn('mt-3 flex shrink-0 items-center justify-center gap-2', !cinematic && 'mt-8')}
        aria-label="部门进度"
      >
        {departments.map((department, index) => (
          <button
            key={department.code}
            type="button"
            aria-label={department.name}
            aria-current={index === activeIndex ? 'true' : undefined}
            className={cn(
              'h-2 rounded-full transition-all duration-200 cinematic-dept-dot',
              cinematic
                ? index === activeIndex
                  ? 'is-active w-6 bg-[var(--brand-gold,#FFD84D)]'
                  : 'w-2 bg-white/25 hover:bg-white/45'
                : index === activeIndex
                  ? 'w-6 bg-foreground/70'
                  : 'w-2 bg-foreground/20 hover:bg-foreground/35',
            )}
            onClick={() => goTo(index, index > activeIndex ? 1 : -1)}
          />
        ))}
      </div>

      {cinematic ? (
        <p className="mt-3 shrink-0 text-center font-body text-[11px] font-light text-white/45">
          当前「{active.name}」· 点击进入
        </p>
      ) : null}
    </div>
  );
}

/** Kept for callers that previously cleaned GSAP Observer instances. */
export function cleanupDepartmentScrollTriggers(): void {
  // no-op — vertical pager no longer uses GSAP Observer
}
