export type ProductionInputSlot = {
  key: string;
  label: string;
  required: boolean;
  hints: string[];
};

export type ProductionException = {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  materialCode?: string;
  materialName?: string;
  workOrder?: string;
  equipment?: string;
  line?: string;
  value?: number | null;
};

export type ProductionExceptionAction =
  | 'confirm'
  | 'ignore_once'
  | 'modify_quantity'
  | 'mark_manual'
  | 'select_option';

export type AppliedProductionAction = {
  exceptionKey: string;
  code: string;
  action: ProductionExceptionAction;
  value?: string | number;
  materialCode?: string;
  workOrder?: string;
  equipment?: string;
  resolvedAt: string;
};

export type ProductionDeliverable = {
  kind: string;
  fileName: string;
  bytes: Uint8Array;
};

export type ProductionWorkflowResult = {
  taskCode: string;
  generatedAt: string;
  blocked: boolean;
  clarifications: Array<{
    id: string;
    message: string;
    options?: Array<{ value: string; label: string }>;
  }>;
  exceptions: ProductionException[];
  summary: Record<string, number>;
  tables: Record<string, Array<Record<string, string | number>>>;
  appliedActions?: AppliedProductionAction[];
  /** 压缩 AI 载荷，禁止含完整原始表 */
  aiPayload?: Record<string, unknown>;
};

export type RawWorkbook = {
  fileName: string;
  sheets: Array<{
    sheetName: string;
    headers: string[];
    rows: Array<Record<string, unknown>>;
  }>;
};

export type RunProductionWorkflowInput = {
  workbooks: RawWorkbook[];
  answers?: Array<{ questionId: string; value: string }>;
  actions?: AppliedProductionAction[];
  organizationId?: string;
};
