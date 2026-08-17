import type { DepartmentCode } from '@workstation/data/departmentAgents';
import { cn } from '@workstation/lib/utils';

type DepartmentIconProps = {
  code: DepartmentCode;
  className?: string;
  animated?: boolean;
};

/** 部门原创可爱图标（CSS 几何组合，无第三方品牌素材） */
export function DepartmentIcon({ code, className, animated }: DepartmentIconProps) {
  return (
    <span
      className={cn(
        'dept-icon relative inline-flex size-11 items-center justify-center',
        animated && 'dept-icon--jelly',
        className,
      )}
      data-dept-icon={code}
      aria-hidden
    >
      <span className="dept-icon__face" />
      <span className="dept-icon__mark" />
    </span>
  );
}
