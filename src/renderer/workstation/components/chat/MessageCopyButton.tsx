import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@workstation/components/ui/tooltip';
import { cn } from '@workstation/lib/utils';

type MessageCopyButtonProps = {
  text: string;
  className?: string;
};

/** ChatGPT 风格：悬停消息时显示复制，点击后短暂显示已复制 */
export function MessageCopyButton({ text, className }: MessageCopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const handleCopy = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      if (!text.trim()) return;
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopied(false), 2000);
      } catch {
        // ignore
      }
    },
    [text],
  );

  return (
    <Tooltip open={copied ? true : undefined}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            'flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors',
            'hover:bg-muted/80 hover:text-foreground',
            copied && 'text-foreground',
            className,
          )}
          aria-label={copied ? '已复制' : '复制'}
        >
          {copied ? (
            <Check className="size-4" strokeWidth={2} />
          ) : (
            <Copy className="size-4" strokeWidth={2} />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{copied ? '已复制' : '复制'}</TooltipContent>
    </Tooltip>
  );
}
