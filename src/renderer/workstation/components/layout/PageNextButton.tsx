import { ArrowRight } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@workstation/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@workstation/components/ui/tooltip';
import { getPageNextTarget } from '@workstation/lib/pageNavigation';
import { cn } from '@workstation/lib/utils';

type PageNextButtonProps = {
  className?: string;
  /** 覆盖默认下一步逻辑 */
  onNext?: () => void;
};

/** 右上角下一步：进入流程下一页 */
export function PageNextButton({ className, onNext }: PageNextButtonProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const target = getPageNextTarget(location.pathname);

  const handleNext = () => {
    if (onNext) {
      onNext();
      return;
    }
    if (target) {
      navigate(target);
    }
  };

  if (!target && !onNext) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'size-9 shrink-0 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground',
            className,
          )}
          onClick={handleNext}
          aria-label="下一步"
        >
          <ArrowRight className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">下一步</TooltipContent>
    </Tooltip>
  );
}
