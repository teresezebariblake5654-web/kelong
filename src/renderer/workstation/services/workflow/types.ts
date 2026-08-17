import type { UploadContext, PreparedRoleInput } from '@aw/data-engine';
import type {
  ExecuteWorkflowRequest,
  ExecuteWorkflowResult,
  WorkflowExceptionSummary,
} from '@aw/shared';

export type WorkflowUiStatus =
  | 'IDLE'
  | 'PARSING'
  | 'READY'
  | 'RUNNING'
  | 'NEEDS_REVIEW'
  | 'COMPLETED'
  | 'FAILED';

export type WorkflowUiPhase =
  | '读取文件'
  | '字段识别'
  | '本地计算'
  | '生成结果'
  | '完成';

export interface LocalWorkspaceConfig {
  rootDir: string;
  companyId: string;
}

export interface SelectedLocalFile {
  /** Display name only in UI; may equal basename. */
  name: string;
  /** Opaque path token; absolute in Tauri, memory:// or virtual in browser. */
  path: string;
  size: number;
  sha256: string;
  /** In-memory bytes for runtime; cleared from UI state after execute when possible. */
  bytes?: Uint8Array;
  extension: string;
}

export interface InspectedInputFile {
  role: string;
  fileName: string;
  /** Number of selected files for this role. */
  fileCount: number;
  sheetName: string;
  rowCount: number;
  recognizedFields: string[];
  missingRequiredFields: string[];
  aliasMappings: Array<{ canonical: string; header: string }>;
  fieldPreviews: Array<{
    field: string;
    dataType: string;
    recognized: boolean;
    maskedSample: string;
  }>;
  canRunRole: boolean;
  parseError?: string;
}

export interface InspectWorkflowInputRequest {
  workflowId: string;
  role: string;
  files: Array<{
    name: string;
    path?: string;
    bytes?: Uint8Array;
  }>;
}

export interface DesktopExecuteRequest {
  workflowId: string;
  inputFiles: Array<{
    role: string;
    path: string;
    sha256: string;
    originalName: string;
    bytes?: Uint8Array;
  }>;
  companyId: string;
  rules?: Record<string, unknown>;
  companyRules?: Record<string, unknown>;
  runDate?: string;
}

export interface DesktopExecuteResult extends ExecuteWorkflowResult {
  effectiveRules: Record<string, unknown>;
  cloudUpload: false;
  executedAt: string;
  phase: WorkflowUiPhase;
}

export type DesktopBridgeErrorCode =
  | 'FILE_NOT_FOUND'
  | 'FILE_LOCKED'
  | 'EXCEL_CORRUPT'
  | 'UNSUPPORTED_FORMAT'
  | 'MISSING_REQUIRED_ROLE'
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_RULES'
  | 'OUTPUT_NOT_WRITABLE'
  | 'WORKSPACE_MISSING'
  | 'WORKFLOW_NOT_FOUND'
  | 'RUN_FAILED'
  | 'RESULT_MISSING'
  | 'BROWSER_OPEN_UNSUPPORTED'
  | 'PATH_TRAVERSAL'
  | 'ALREADY_RUNNING'
  | 'UNKNOWN';

export class DesktopBridgeError extends Error {
  readonly code: DesktopBridgeErrorCode;
  readonly technicalDetail?: string;

  constructor(code: DesktopBridgeErrorCode, message: string, technicalDetail?: string) {
    super(message);
    this.name = 'DesktopBridgeError';
    this.code = code;
    this.technicalDetail = technicalDetail;
  }
}

export interface DesktopWorkflowBridge {
  getWorkspaceConfig(): Promise<LocalWorkspaceConfig>;
  setWorkspaceConfig(config: LocalWorkspaceConfig): Promise<void>;
  selectWorkspaceDirectory(): Promise<string | null>;

  selectInputFile(options: {
    extensions: string[];
    multiple?: boolean;
  }): Promise<SelectedLocalFile | null>;

  selectInputFiles(options: {
    extensions: string[];
  }): Promise<SelectedLocalFile[]>;

  inspectInputFile(input: {
    workflowId: string;
    role: string;
    path: string;
    bytes?: Uint8Array;
    fileName?: string;
  }): Promise<InspectedInputFile>;

  inspectWorkflowInput(input: InspectWorkflowInputRequest): Promise<InspectedInputFile>;

  detectUploadContext(input: {
    workflowId: string;
    files: SelectedLocalFile[];
    answers?: Record<string, string>;
  }): Promise<{ context: UploadContext; preparedInputs: PreparedRoleInput[] }>;

  getWorkflowRules(workflowId: string): Promise<{
    defaults: Record<string, unknown>;
    company: Record<string, unknown>;
    effective: Record<string, unknown>;
  }>;

  saveWorkflowRules(workflowId: string, rules: Record<string, unknown>): Promise<void>;
  resetWorkflowRules(workflowId: string): Promise<Record<string, unknown>>;

  executeWorkflow(request: DesktopExecuteRequest): Promise<DesktopExecuteResult>;

  openFile(path: string, bytes?: Uint8Array, fileName?: string): Promise<void>;
  revealInFolder(path: string): Promise<void>;

  /** Pre-check OCR / format capability for a selected input. */
  checkWorkflowInputCapability(input: {
    workflowId: string;
    role: string;
    fileName: string;
    extension?: string;
  }): import('./workflowCapabilities').WorkflowInputCapability;

  /** Test/diagnostics: count of fetch calls made by this bridge (should stay 0 for workflow runs). */
  getFetchCallCount(): number;
}

export type { ExecuteWorkflowRequest, ExecuteWorkflowResult, WorkflowExceptionSummary };

