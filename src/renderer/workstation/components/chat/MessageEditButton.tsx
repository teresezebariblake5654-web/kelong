import { Pencil } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@workstation/components/ui/tooltip';
import { cn } from '@workstation/lib/utils';

type MessageEditButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
};

export function MessageEditButton({ onClick, disabled, className }: MessageEditButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          className={cn(
            'flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors',
            'hover:bg-muted/80 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
            className,
          )}
          aria-label="编辑消息"
        >
          <Pencil className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">编辑消息</TooltipContent>
    </Tooltip>
  );
}
