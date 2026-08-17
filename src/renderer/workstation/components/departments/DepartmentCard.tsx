import { motion } from 'motion/react';
import type { DepartmentAgent } from '@workstation/data/departmentAgents';
import { DepartmentIcon } from '@workstation/components/departments/DepartmentIcon';
import { usePrefersReducedMotion } from '@workstation/hooks/usePrefersReducedMotion';
import { cn } from '@workstation/lib/utils';

type DepartmentCardProps = {
  department: DepartmentAgent;
  onClick: () => void;
};

const jelly = { type: 'spring' as const, stiffness: 420, damping: 18, mass: 0.55 };

export function DepartmentCard({ department, onClick }: DepartmentCardProps) {
  const reduced = usePrefersReducedMotion();
  const count = department.workflows.length;

  return (
    <motion.button
      type="button"
      className={cn(
        'dept-card group relative flex h-full w-full flex-col overflow-hidden rounded-[20px] border border-black/5 p-5 text-left shadow-[0_8px_24px_-16px_rgba(15,23,42,0.28)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10',
      )}
      style={{
        background: `linear-gradient(155deg, ${department.theme.from} 0%, ${department.theme.to} 100%)`,
      }}
      initial={false}
      whileHover={
        reduced
          ? undefined
          : {
              y: -8,
              scale: 1.02,
              transition: jelly,
            }
      }
      whileTap={reduced ? undefined : { scale: 0.985, y: -2, transition: { duration: 0.2 } }}
      onClick={onClick}
    >
      <motion.div
        className="mb-4 inline-flex"
        whileHover={
          reduced
            ? undefined
            : {
                scale: [1, 0.9, 1.06, 1],
                rotate: [0, -6, 5, 0],
                transition: { duration: 0.42, ease: 'easeOut' },
              }
        }
      >
        <span
          className="flex size-12 items-center justify-center rounded-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_8px_16px_-8px_rgba(15,23,42,0.35)]"
          style={{ background: department.theme.iconBg }}
        >
          <DepartmentIcon code={department.icon} animated className="text-white" />
        </span>
      </motion.div>

      <div className="text-[15px] font-semibold tracking-tight text-foreground">
        {department.name}
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {department.description}
      </p>
      <div className="mt-4 text-[11px] font-medium" style={{ color: department.theme.accent }}>
        {count} 个工作模式
      </div>
    </motion.button>
  );
}
