import { useLocation, useNavigate } from 'react-router-dom';
import { WORKFLOW_STEPS } from '@workstation/constants/workflow';
import { cn } from '@workstation/lib/utils';
import { useWorkflow } from '@workstation/state/workflow';
import { workflowStepSatisfied } from '@workstation/state/workflowSession';

export function WorkflowStepper() {
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useWorkflow();
  const currentIndex = WORKFLOW_STEPS.findIndex((step) => step.path === location.pathname);

  if (currentIndex < 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="业务流程步骤">
      {WORKFLOW_STEPS.map((step, index) => {
        const reachable = workflowStepSatisfied(step.key, state) || index <= currentIndex;
        const active = index === currentIndex;
        const done = index < currentIndex && workflowStepSatisfied(step.key, state);
        return (
          <button
            key={step.key}
            type="button"
            disabled={!reachable}
            onClick={() => reachable && navigate(step.path)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] transition-colors',
              active && 'bg-accent text-accent-foreground',
              done && !active && 'text-success',
              !active && !done && 'text-muted-foreground',
              !reachable && 'cursor-not-allowed opacity-40',
            )}
          >
            <span
              className={cn(
                'inline-flex size-[18px] items-center justify-center rounded-full text-[10px]',
                active && 'bg-primary text-primary-foreground',
                done && !active && 'bg-success text-success-foreground',
                !active && !done && 'bg-muted text-muted-foreground',
              )}
            >
              {index + 1}
            </span>
            <span>{step.label}</span>
          </button>
        );
      })}
    </div>
  );
}
