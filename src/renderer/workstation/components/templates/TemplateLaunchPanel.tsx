import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from '@workstation/components/ui/button';
import { cn } from '@workstation/lib/utils';
import type { BusinessTemplate } from '@workstation/types';

type TemplateLaunchPanelProps = {
  template: BusinessTemplate;
  categoryName: string;
  open: boolean;
  onClose: () => void;
  onStart: () => void;
};

/** Dialog launcher — template list stays mounted underneath. */
export function TemplateLaunchPanel({
  template,
  categoryName,
  open,
  onClose,
  onStart,
}: TemplateLaunchPanelProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/25" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2',
            'rounded-[14px] border border-border bg-card p-5 shadow-[var(--aw-shadow-sm)]',
            'focus:outline-none',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <Dialog.Title className="text-base font-semibold">{template.name}</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                {categoryName} · 预计 {template.creditCost} 额度
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="关闭"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <dl className="mt-4 space-y-3 text-xs">
            <div>
              <dt className="text-muted-foreground">文件要求</dt>
              <dd className="mt-0.5 text-foreground">
                支持 {template.fileTypes.map((f) => f.toUpperCase()).join(' / ')}
              </dd>
              <dd className="mt-0.5 text-muted-foreground">
                必填字段：
                {template.requiredFields.length ? template.requiredFields.join('、') : '无强制字段'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">功能说明</dt>
              <dd className="mt-0.5 text-foreground">{template.features.join(' · ')}</dd>
              <dd className="mt-0.5 text-muted-foreground">{template.description}</dd>
            </div>
          </dl>

          <div className="mt-5 flex gap-2">
            <Button className="flex-1" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button className="flex-1" onClick={onStart}>
              开始任务
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
