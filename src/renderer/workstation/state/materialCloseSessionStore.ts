import { create } from 'zustand';
import type {
  AppliedExceptionAction,
  ClarificationQuestion,
  DeliverableFile,
  MaterialDailyCloseWorkflowResult,
  RawWorkbookInput,
  UserClarificationAnswer,
} from '@aw/task-workflows';

export type MaterialCloseStep = 'start' | 'exception' | 'result';

export type SlotKey = 'inventory' | 'issue' | 'return' | 'scrap';

type MaterialCloseSessionState = {
  step: MaterialCloseStep;
  slots: Partial<Record<SlotKey, RawWorkbookInput>>;
  workbooks: RawWorkbookInput[];
  answers: UserClarificationAnswer[];
  clarifications: ClarificationQuestion[];
  result: MaterialDailyCloseWorkflowResult | null;
  actions: AppliedExceptionAction[];
  deliverables: DeliverableFile[];
  runId: string | null;
  clientRequestId: string | null;
  creditsCharged: number;
  busy: boolean;
  error: string | null;
  rulesHint: string | null;
  setStep: (step: MaterialCloseStep) => void;
  setSlot: (slot: SlotKey, workbook: RawWorkbookInput | null) => void;
  setWorkbooks: (workbooks: RawWorkbookInput[]) => void;
  setAnswers: (answers: UserClarificationAnswer[]) => void;
  setClarifications: (items: ClarificationQuestion[]) => void;
  setResult: (result: MaterialDailyCloseWorkflowResult | null) => void;
  setActions: (actions: AppliedExceptionAction[]) => void;
  setDeliverables: (files: DeliverableFile[]) => void;
  setRunMeta: (meta: { runId: string | null; clientRequestId: string | null; creditsCharged?: number }) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  setRulesHint: (hint: string | null) => void;
  reset: () => void;
};

const initial = {
  step: 'start' as MaterialCloseStep,
  slots: {} as Partial<Record<SlotKey, RawWorkbookInput>>,
  workbooks: [] as RawWorkbookInput[],
  answers: [] as UserClarificationAnswer[],
  clarifications: [] as ClarificationQuestion[],
  result: null as MaterialDailyCloseWorkflowResult | null,
  actions: [] as AppliedExceptionAction[],
  deliverables: [] as DeliverableFile[],
  runId: null as string | null,
  clientRequestId: null as string | null,
  creditsCharged: 0,
  busy: false,
  error: null as string | null,
  rulesHint: null as string | null,
};

export const useMaterialCloseSessionStore = create<MaterialCloseSessionState>((set) => ({
  ...initial,
  setStep: (step) => set({ step }),
  setSlot: (slot, workbook) =>
    set((state) => {
      const slots = { ...state.slots };
      if (!workbook) delete slots[slot];
      else slots[slot] = workbook;
      const workbooks = Object.values(slots).filter(Boolean) as RawWorkbookInput[];
      return { slots, workbooks };
    }),
  setWorkbooks: (workbooks) => set({ workbooks }),
  setAnswers: (answers) => set({ answers }),
  setClarifications: (clarifications) => set({ clarifications }),
  setResult: (result) => set({ result }),
  setActions: (actions) => set({ actions }),
  setDeliverables: (deliverables) => set({ deliverables }),
  setRunMeta: ({ runId, clientRequestId, creditsCharged }) =>
    set((state) => ({
      runId,
      clientRequestId,
      creditsCharged: creditsCharged ?? state.creditsCharged,
    })),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  setRulesHint: (rulesHint) => set({ rulesHint }),
  reset: () => set({ ...initial, slots: {}, workbooks: [], answers: [], clarifications: [], actions: [], deliverables: [] }),
}));
