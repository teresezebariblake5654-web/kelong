import { RotateCcw } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@workstation/components/ui/tooltip';
import { cn } from '@workstation/lib/utils';

type MessageRegenerateButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  spinning?: boolean;
  className?: string;
};

export function MessageRegenerateButton({
  onClick,
  disabled,
  spinning,
  className,
}: MessageRegenerateButtonProps) {
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
          aria-label="重新生成"
        >
          <RotateCcw className={cn('size-4', spinning && 'animate-spin')} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{spinning ? '生成中…' : '重新生成'}</TooltipContent>
    </Tooltip>
  );
}
