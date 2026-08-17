import type { WalletSnapshot } from '@aw/shared';
import type {
  SheetData,
  StructuredResult,
  TemplateExecutionResult,
  WorkbookData,
} from '@aw/data-engine';
import type { AgentRole, LocalTaskTemplate } from '@aw/task-templates';
import type { DepartmentCode } from '@workstation/data/departmentAgents';

export type WorkflowStepKey =
  | 'role'
  | 'task'
  | 'import'
  | 'sheet'
  | 'mapping'
  | 'clean'
  | 'anomalies'
  | 'progress'
  | 'report'
  | 'history';

export type WorkflowSession = {
  role?: AgentRole;
  /** 从工作智能体发起时记录，用于保存可恢复会话 */
  departmentCode?: DepartmentCode;
  task?: LocalTaskTemplate;
  fileName?: string;
  /** excel=本地表格解析；document=上传至云端后走智能分析 */
  importMode?: 'excel' | 'document';
  uploadedFileId?: string;
  /** 已上传文件 ID 列表（文档分析可多文件） */
  fileIds?: string[];
  /** 用户附加分析指令 */
  userInstruction?: string;
  /** 模板分析会话 ID，用于报告页继续追问 */
  conversationId?: string;
  /** 报告页追问对话 */
  followUps?: Array<{ role: 'user' | 'assistant'; content: string }>;
  workbook?: WorkbookData;
  sheetName?: string;
  sheet?: SheetData;
  /** fieldKey -> source column name */
  fieldMappings?: Record<string, string>;
  templateResult?: TemplateExecutionResult;
  structured?: StructuredResult;
  analysisText?: string;
  analysisResult?: unknown;
  taskId?: string;
  wallet?: WalletSnapshot;
  estimatedCredits?: number;
  error?: string;
};

export function createWorkflowSession(): WorkflowSession {
  return {};
}

type WorkflowAction =
  | { type: 'patch'; payload: Partial<WorkflowSession> }
  | { type: 'reset-pipeline' }
  | { type: 'reset-all' };

const PIPELINE_KEYS: Array<keyof WorkflowSession> = [
  'departmentCode',
  'task',
  'fileName',
  'importMode',
  'uploadedFileId',
  'fileIds',
  'userInstruction',
  'conversationId',
  'followUps',
  'workbook',
  'sheetName',
  'sheet',
  'fieldMappings',
  'templateResult',
  'structured',
  'analysisText',
  'analysisResult',
  'taskId',
  'estimatedCredits',
  'error',
];

export function workflowReducer(state: WorkflowSession, action: WorkflowAction): WorkflowSession {
  if (action.type === 'patch') {
    return { ...state, ...action.payload };
  }
  if (action.type === 'reset-pipeline') {
    const next = { ...state };
    for (const key of PIPELINE_KEYS) {
      delete next[key];
    }
    return next;
  }
  if (action.type === 'reset-all') {
    return createWorkflowSession();
  }
  return state;
}

/** Prerequisites to enter a step page (not completion). */
export function workflowCanEnter(step: WorkflowStepKey, state: WorkflowSession): boolean {
  switch (step) {
    case 'role':
      return true;
    case 'task':
      return Boolean(state.role);
    case 'import':
      return Boolean(state.role && state.task);
    case 'sheet':
      return Boolean(state.importMode !== 'document' && state.workbook && state.workbook.sheets.length > 0);
    case 'mapping':
      return Boolean(state.importMode !== 'document' && state.sheet && state.task);
    case 'clean':
      return Boolean(state.importMode !== 'document' && state.templateResult && state.sheet);
    case 'anomalies':
      return Boolean(state.importMode !== 'document' && state.templateResult);
    case 'progress':
      if (state.importMode === 'document') {
        return Boolean(
          state.task &&
            (state.uploadedFileId ||
              (state.fileIds && state.fileIds.length > 0) ||
              state.userInstruction?.trim()),
        );
      }
      return Boolean(state.structured && state.templateResult && state.task);
    case 'report':
      if (state.importMode === 'document') {
        return Boolean(state.analysisText || state.analysisResult);
      }
      return Boolean(state.structured && (state.analysisText || state.analysisResult));
    case 'history':
      return true;
    default:
      return false;
  }
}

/** Whether a step has enough data to be considered completed / navigable from stepper. */
export function workflowStepSatisfied(step: WorkflowStepKey, state: WorkflowSession): boolean {
  switch (step) {
    case 'role':
      return Boolean(state.role);
    case 'task':
      return Boolean(state.role && state.task);
    case 'import':
      return Boolean(state.workbook || state.uploadedFileId || (state.fileIds && state.fileIds.length > 0));
    case 'sheet':
      return Boolean(state.sheet);
    case 'mapping':
      return Boolean(state.templateResult && state.fieldMappings);
    case 'clean':
      return Boolean(state.templateResult);
    case 'anomalies':
      return Boolean(state.structured);
    case 'progress':
      return Boolean(state.analysisText || state.analysisResult);
    case 'report':
      if (state.importMode === 'document') {
        return Boolean(state.analysisText || state.analysisResult);
      }
      return Boolean(state.structured && (state.analysisText || state.analysisResult));
    case 'history':
      return true;
    default:
      return false;
  }
}
