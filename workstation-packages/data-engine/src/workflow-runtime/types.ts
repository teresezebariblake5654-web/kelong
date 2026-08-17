import type {
  ExecuteWorkflowRequest,
  ExecuteWorkflowResult,
  SourceTraceRef,
  WorkflowDefinition,
} from '@aw/shared';
import type { DataRow, SheetData, WorkbookData } from '../types.js';

export type OperatorContext = {
  definition: WorkflowDefinition;
  request: ExecuteWorkflowRequest;
  companyRules: Record<string, unknown>;
  runId: string;
  runDate: string;
  workflowVersion: string;
  datasets: Map<string, NormalizedDataset>;
  resultTables: Map<string, DataRow[]>;
  exceptions: Array<{
    code: string;
    severity: 'INFO' | 'WARNING' | 'BLOCKING';
    message: string;
    row?: DataRow;
  }>;
  metrics: Record<string, number | string | boolean | null>;
  traces: SourceTraceRef[];
  inputSha256ByRole: Map<string, string>;
};

export type NormalizedDataset = {
  role: string;
  fileName: string;
  filePath: string;
  sha256: string;
  sheetName: string;
  rows: DataRow[];
  headers: string[];
  workbook: WorkbookData;
  sheet: SheetData;
};

export type OperatorFn = (
  ctx: OperatorContext,
  params?: Record<string, unknown>,
) => void | Promise<void>;

export type WorkflowHandler = (
  ctx: OperatorContext,
  definition: WorkflowDefinition,
) => Promise<ExecuteWorkflowResult>;

export type WorkflowRuntimeDeps = {
  outputDir?: string;
};
