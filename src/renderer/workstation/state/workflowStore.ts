import { useShallow } from 'zustand/react/shallow';
import { create } from 'zustand';
import type { WorkflowSession } from '@workstation/state/workflowSession';
import { createWorkflowSession } from '@workstation/state/workflowSession';

type WorkflowActions = {
  patch: (next: Partial<WorkflowSession>) => void;
  resetPipeline: () => void;
  resetAll: () => void;
};

type WorkflowStore = WorkflowSession & WorkflowActions;

export const useWorkflowStore = create<WorkflowStore>((set) => ({
  ...createWorkflowSession(),
  patch: (next) => set((state) => ({ ...state, ...next })),
  resetPipeline: () =>
    set((state) => ({
      ...createWorkflowSession(),
      role: state.role,
      wallet: state.wallet,
      patch: state.patch,
      resetPipeline: state.resetPipeline,
      resetAll: state.resetAll,
    })),
  resetAll: () =>
    set((state) => ({
      ...createWorkflowSession(),
      patch: state.patch,
      resetPipeline: state.resetPipeline,
      resetAll: state.resetAll,
    })),
}));

/** Compatibility hook used by existing pages. */
export function useWorkflow() {
  const patch = useWorkflowStore((s) => s.patch);
  const resetPipeline = useWorkflowStore((s) => s.resetPipeline);
  const resetAll = useWorkflowStore((s) => s.resetAll);
  const state = useWorkflowStore(
    useShallow((s) => {
      const { patch: _p, resetPipeline: _rp, resetAll: _ra, ...session } = s;
      return session;
    }),
  );
  return { state, patch, resetPipeline, resetAll };
}
