import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@workstation/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@workstation/components/ui/tooltip';
import { getPageBackFallback } from '@workstation/lib/pageNavigation';
import { cn } from '@workstation/lib/utils';

type PageBackButtonProps = {
  className?: string;
  /** 覆盖默认返回逻辑 */
  onBack?: () => void;
  /** Tooltip / accessible name */
  label?: string;
};

/** 醒目黑色左箭头返回键 */
export function PageBackButton({
  className,
  onBack,
  label = '返回',
}: PageBackButtonProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    const target = getPageBackFallback(location.pathname);
    if (!target) {
      navigate('/');
      return;
    }
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(target);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'size-10 shrink-0 rounded-xl text-black hover:bg-black/5 hover:text-black',
            className,
          )}
          onClick={handleBack}
          aria-label={label}
        >
          <ArrowLeft className="size-6 stroke-[2.5]" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
