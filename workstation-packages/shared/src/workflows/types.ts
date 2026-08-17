export type WorkflowCategory = 'production' | 'hr' | 'finance' | 'ecommerce' | 'admin' | 'logistics';
export type DeliveryWave = 1 | 2;
export type WorkflowComplexity = 'low' | 'medium' | 'high' | 'very_high';

export type WorkflowRunStatus =
  | 'CREATED'
  | 'INPUT_LOADED'
  | 'VALIDATED'
  | 'NEEDS_CONFIRMATION'
  | 'RUNNING'
  | 'NEEDS_REVIEW'
  | 'COMPLETED'
  | 'FAILED';

export type WorkflowExceptionSeverity = 'INFO' | 'WARNING' | 'BLOCKING';

export interface WorkflowInputRole {
  role: string;
  required: boolean;
  requiredFields: string[];
  description?: string;
}

export interface WorkflowStep {
  op: string;
  params?: Record<string, unknown>;
}

export interface WorkflowOutputSpec {
  fileNameTemplate: string;
  sheets: string[];
  alwaysGenerateSourceTrace: boolean;
  alwaysGenerateRunSummary: boolean;
}

export interface SpecialAdapterSpec {
  name: string;
  required: boolean;
  firstImplementation?: string;
  note?: string;
}

export interface WorkflowDefinition {
  id: string;
  category: WorkflowCategory;
  name: string;
  deliveryWave: DeliveryWave;
  complexity: WorkflowComplexity;
  businessGoal: string;
  inputRoles: WorkflowInputRole[];
  companyRuleKeys: string[];
  criticalQuestions: string[];
  steps: WorkflowStep[];
  calculations: string[];
  exceptionRules: string[];
  output: WorkflowOutputSpec;
  manualReviewTriggers: string[];
  acceptanceCriteria: string[];
  specialAdapter?: SpecialAdapterSpec;
}

export interface WorkflowCatalogArchitecture {
  principle: string;
  localExecution: string[];
  cloudBackend: string[];
  forbiddenCloudPayloadsByDefault: string[];
  deterministicRule: string;
}

export interface WorkflowCatalogRuntime {
  recommendedLocations: Record<string, string>;
  runStates: WorkflowRunStatus[];
  genericOperators: string[];
  outputWorkbookRules: string[];
  interactionRules: string[];
}

export interface WorkflowCatalog {
  schemaVersion: string;
  catalogId: string;
  generatedFor: string;
  architecture: WorkflowCatalogArchitecture;
  runtime: WorkflowCatalogRuntime;
  workflows: WorkflowDefinition[];
}

export interface WorkflowInputFile {
  role: string;
  /**
   * Absolute or relative local filesystem path. Never uploaded to backend.
   * May be a display name / memory URI when `bytes` is provided (browser bridge).
   */
  path: string;
  /** Optional precomputed SHA-256 of file bytes. Computed locally when omitted. */
  sha256?: string;
  /** Original file name for exporters / traces (optional). */
  originalName?: string;
  /**
   * Optional in-memory bytes for browser / desktop bridges without Node fs reads.
   * When present, WorkflowRuntime must prefer bytes over reading `path` from disk.
   */
  bytes?: Uint8Array;
}

export interface WorkflowOutputArtifact {
  fileName: string;
  /** Absolute path when written to disk; may be a memory:// URI in browser mode. */
  path: string;
  bytes?: Uint8Array;
}

export interface ExecuteWorkflowRequest {
  workflowId: string;
  inputFiles: WorkflowInputFile[];
  /** Optional company id for persisted local rule files. */
  companyId?: string;
  /**
   * Run-time rule overrides (highest priority).
   * Precedence: rules > companyRules > persisted company file > workflow defaults.
   */
  rules?: Record<string, unknown>;
  companyRules?: Record<string, unknown>;
  answers?: Record<string, unknown>;
  outputDir: string;
  runDate?: string;
}

export interface WorkflowExceptionSummary {
  code: string;
  severity: WorkflowExceptionSeverity;
  count: number;
  message?: string;
}

export interface WorkflowClarificationQuestion {
  key: string;
  question: string;
}

export interface ExecuteWorkflowResult {
  runId: string;
  workflowId: string;
  workflowVersion: string;
  status: Extract<WorkflowRunStatus, 'COMPLETED' | 'NEEDS_REVIEW' | 'NEEDS_CONFIRMATION' | 'FAILED'>;
  outputFiles: string[];
  /** Optional in-memory artifacts (browser / capture mode). Never uploaded. */
  outputArtifacts?: WorkflowOutputArtifact[];
  metrics: Record<string, number | string | boolean | null>;
  exceptions: WorkflowExceptionSummary[];
  clarificationQuestions?: WorkflowClarificationQuestion[];
  /** Desensitized aggregates / exception samples only — never raw workbook rows. */
  aiSummaryPayload?: Record<string, unknown>;
  errorMessage?: string;
}

export interface SourceTraceRef {
  sourceFile: string;
  sourceSheet: string;
  sourceRow: number;
  workflowVersion: string;
  inputSha256: string;
  role?: string;
  traceId?: string;
}
