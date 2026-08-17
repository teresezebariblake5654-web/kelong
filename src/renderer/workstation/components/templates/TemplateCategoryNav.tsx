import { ScrollArea } from '@workstation/components/ui/scroll-area';
import type { TemplateCategory, TemplateCategoryId } from '@workstation/types';
import { cn } from '@workstation/lib/utils';

type TemplateCategoryNavProps = {
  categories: TemplateCategory[];
  totalCount: number;
  activeId: TemplateCategoryId | 'all';
  onSelect: (id: TemplateCategoryId | 'all') => void;
};

export function TemplateCategoryNav({
  categories,
  totalCount,
  activeId,
  onSelect,
}: TemplateCategoryNavProps) {
  return (
    <aside className="flex w-52 shrink-0 flex-col rounded-[12px] border border-border bg-card">
      <div className="border-b border-border px-3 py-3 text-sm font-semibold">智能体分类</div>
      <ScrollArea className="flex-1 p-2">
        <NavItem
          label="全部"
          count={totalCount}
          active={activeId === 'all'}
          onClick={() => onSelect('all')}
        />
        {categories.map((dept) => (
          <NavItem
            key={dept.id}
            label={dept.name}
            count={dept.templateCount}
            active={activeId === dept.id}
            deptId={dept.id}
            onClick={() => onSelect(dept.id)}
          />
        ))}
      </ScrollArea>
    </aside>
  );
}

function NavItem({
  label,
  count,
  active,
  deptId,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  deptId?: TemplateCategoryId;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-dept={deptId}
      className={cn(
        'mb-0.5 flex w-full items-center justify-between rounded-[10px] px-2.5 py-2 text-left text-sm transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      onClick={onClick}
    >
      <span className="flex items-center gap-2">
        {deptId ? <span className="dept-accent-dot size-1.5 rounded-full" aria-hidden /> : null}
        {label}
      </span>
      <span className="font-mono text-xs tabular-nums">{count}</span>
    </button>
  );
}
