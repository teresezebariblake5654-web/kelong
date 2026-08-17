import { FileSpreadsheet, Play, Star } from 'lucide-react';
import { motion } from 'motion/react';
import { Badge } from '@workstation/components/ui/badge';
import { Button } from '@workstation/components/ui/button';
import { usePrefersReducedMotion } from '@workstation/hooks/usePrefersReducedMotion';
import type { BusinessTemplate } from '@workstation/types';
import { cn } from '@workstation/lib/utils';

type TemplateCardProps = {
  template: BusinessTemplate;
  selected: boolean;
  dimmed: boolean;
  compact?: boolean;
  categoryName: string;
  onUse: () => void;
  onToggleFavorite: () => void;
};

const jellySpring = { type: 'spring' as const, stiffness: 420, damping: 24, mass: 0.55 };

export function TemplateCard({
  template,
  selected,
  dimmed,
  compact,
  categoryName,
  onUse,
  onToggleFavorite,
}: TemplateCardProps) {
  const reduced = usePrefersReducedMotion();

  return (
    <motion.div
      role="button"
      tabIndex={0}
      data-dept={template.categoryId}
      className={cn(
        'dept-accent-bar relative cursor-pointer rounded-[12px] border bg-card p-4 text-left will-change-transform',
        selected
          ? 'z-20 border-primary shadow-[0_10px_28px_-12px_hsl(var(--primary)/0.55)]'
          : 'z-0 border-border shadow-sm',
        dimmed && 'pointer-events-none opacity-40',
      )}
      initial={false}
      animate={
        reduced
          ? { scale: 1, y: 0 }
          : selected
            ? { scale: 1.035, y: -6 }
            : { scale: 1, y: 0 }
      }
      whileHover={
        reduced || selected || dimmed
          ? undefined
          : {
              scale: 1.045,
              y: -8,
              boxShadow: '0 16px 32px -16px hsl(var(--foreground) / 0.28)',
            }
      }
      whileTap={reduced || dimmed ? undefined : { scale: 0.985, y: -2 }}
      transition={jellySpring}
      onClick={onUse}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onUse();
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <div className="dept-accent-icon flex size-9 shrink-0 items-center justify-center rounded-[10px]">
            <FileSpreadsheet className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{template.name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{categoryName}</div>
          </div>
        </div>
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={template.favorited ? '取消收藏' : '收藏'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
        >
          <Star className={cn('size-4', template.favorited && 'fill-warning text-warning')} />
        </button>
      </div>

      <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {template.scenario}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge variant="secondary">{template.dataTypes.join(' / ') || '表格'}</Badge>
        {!compact ? <Badge variant="outline">{template.fileTypes.slice(0, 2).join(' / ')}</Badge> : null}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>使用 {template.usageCount} 次</span>
        <span>
          {template.lastUsedAt
            ? `最近 ${new Date(template.lastUsedAt).toLocaleDateString('zh-CN')}`
            : '尚未使用'}
        </span>
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground">{template.features.join(' · ')}</div>

      <Button
        size="sm"
        className="mt-3 w-full"
        onClick={(e) => {
          e.stopPropagation();
          onUse();
        }}
      >
        <Play className="size-3.5" />
        开始任务
      </Button>
    </motion.div>
  );
}
