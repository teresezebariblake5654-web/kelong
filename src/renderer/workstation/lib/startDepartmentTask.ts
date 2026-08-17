import { dataEngine } from '@aw/data-engine';
import { isExcelUploadExtension } from '@aw/shared';
import { getTaskTemplate } from '@aw/task-templates';
import type { AgentRole, LocalTaskTemplate } from '@aw/task-templates';
import { resolveProductionWorkflowCode } from '@aw/task-workflows';
import type { NavigateFunction } from 'react-router-dom';
import type { DepartmentAgent, WorkflowMode } from '@workstation/data/departmentAgents';
import { getUserAccessToken, recordTemplateUse } from '@workstation/lib/localStore';
import { uploadChatAttachment } from '@workstation/services/chat/cloudChat.service';
import {
  catalogCategoryFromDepartmentCode,
  departmentRunPath,
  resolveDepartmentWorkflowId,
  type DepartmentWorkflowCategory,
} from '@workstation/services/workflow';
import type { WorkflowSession } from '@workstation/state/workflowSession';

const CLEAR_PIPELINE_PATCH: Partial<WorkflowSession> = {
  sheetName: undefined,
  sheet: undefined,
  fieldMappings: undefined,
  templateResult: undefined,
  structured: undefined,
  analysisText: undefined,
  analysisResult: undefined,
  taskId: undefined,
  error: undefined,
  importMode: undefined,
  uploadedFileId: undefined,
  fileIds: undefined,
  conversationId: undefined,
  followUps: undefined,
  workbook: undefined,
};

export class StartDepartmentTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StartDepartmentTaskError';
  }
}

export type StartDepartmentTaskInput = {
  department: DepartmentAgent;
  mode: WorkflowMode;
  instruction: string;
  files: File[];
  navigate: NavigateFunction;
  patch: (payload: Partial<WorkflowSession>) => void;
  resetCurrentTemplate: () => void;
  setCurrentFile: (fileName: string | null) => void;
};

function minimalCatalogTaskStub(mode: WorkflowMode, role: AgentRole): LocalTaskTemplate {
  return {
    code: mode.templateCode,
    version: mode.version ?? '1.0.0',
    role,
    agentType: role === 'hr' ? 'HR' : role === 'production' ? 'PRODUCTION' : 'UNIVERSAL',
    productType: role === 'hr' ? 'HR_AGENT' : 'MANUFACTURING_AGENT',
    allowedProductTypes: role === 'hr' ? ['HR_AGENT', 'FULL_AGENT'] : ['MANUFACTURING_AGENT', 'FULL_AGENT'],
    name: mode.name,
    description: mode.description,
    fields: [],
    localOperations: [],
    anomalyRules: [],
    structuredOutputSchema: { type: 'object', required: [], properties: {} },
    reportSections: [],
    creditCost: 0,
    enabled: true,
    aiSummary: {
      enabled: false,
      systemPrompt: '',
      promptTemplate: '',
      temperature: 0,
      maxOutputTokens: 0,
    },
    reportExport: {
      enabled: true,
      formats: ['xlsx'],
      defaultFormat: 'xlsx',
      fileNameTemplate: '{code}-{date}',
    },
    estimatedCredits: 0,
    requiredFields: [],
  };
}

function navigateCatalogWorkflow(input: {
  category: DepartmentWorkflowCategory;
  department: DepartmentAgent;
  mode: WorkflowMode;
  instruction: string;
  catalogWorkflowId: string;
  navigate: NavigateFunction;
  patch: (payload: Partial<WorkflowSession>) => void;
  resetCurrentTemplate: () => void;
}): void {
  const { category, department, mode, instruction, catalogWorkflowId, navigate, patch, resetCurrentTemplate } =
    input;
  if (!getUserAccessToken()) {
    throw new StartDepartmentTaskError('请先登录后再提交任务');
  }
  const task =
    getTaskTemplate(mode.templateCode, mode.version) ??
    minimalCatalogTaskStub(mode, category === 'hr' ? 'hr' : 'production');

  resetCurrentTemplate();
  recordTemplateUse(mode.templateCode);
  patch({
    ...CLEAR_PIPELINE_PATCH,
    departmentCode: department.code,
    role: task.role as AgentRole,
    task,
    estimatedCredits: task.estimatedCredits,
    userInstruction: instruction.trim() || undefined,
    followUps: [],
  });
  navigate(departmentRunPath(category, catalogWorkflowId));
}

/** 将部门工作流提交接入现有 Import/Progress/Report 流水线 */
export async function startDepartmentTask({
  department,
  mode,
  instruction,
  files,
  navigate,
  patch,
  resetCurrentTemplate,
  setCurrentFile,
}: StartDepartmentTaskInput): Promise<void> {
  // 生产 / 人事 / 财务 / 电商 / 物流 / 行政：统一本地工作流运行页，绕过九步向导
  const catalogCategory = catalogCategoryFromDepartmentCode(department.code);
  if (catalogCategory) {
    const catalogWorkflowId =
      resolveDepartmentWorkflowId(catalogCategory, mode.templateCode) ||
      resolveDepartmentWorkflowId(
        catalogCategory,
        catalogCategory === 'production'
          ? (resolveProductionWorkflowCode(mode.templateCode) ?? '')
          : mode.templateCode,
      ) ||
      resolveDepartmentWorkflowId(catalogCategory, mode.name);
    if (catalogWorkflowId) {
      navigateCatalogWorkflow({
        category: catalogCategory,
        department,
        mode,
        instruction,
        catalogWorkflowId,
        navigate,
        patch,
        resetCurrentTemplate,
      });
      return;
    }
  }

  const task = getTaskTemplate(mode.templateCode, mode.version);
  if (!task) {
    throw new StartDepartmentTaskError('未找到对应的工作模式模板');
  }

  const trimmedInstruction = instruction.trim();
  if (!files.length && !trimmedInstruction) {
    throw new StartDepartmentTaskError('请上传文件或输入分析说明');
  }

  if (!getUserAccessToken()) {
    throw new StartDepartmentTaskError('请先登录后再提交任务');
  }

  const excelFiles = files.filter((file) => isExcelUploadExtension(file.name));
  const nonExcelFiles = files.filter((file) => !isExcelUploadExtension(file.name));

  if (excelFiles.length > 0 && nonExcelFiles.length > 0) {
    throw new StartDepartmentTaskError('请勿同时上传 Excel 与其他类型文件，请分开提交');
  }
  if (excelFiles.length > 1) {
    throw new StartDepartmentTaskError('一次只能上传一个 Excel 文件');
  }

  resetCurrentTemplate();
  recordTemplateUse(mode.templateCode);
  patch({
    ...CLEAR_PIPELINE_PATCH,
    departmentCode: department.code,
    role: task.role as AgentRole,
    task,
    estimatedCredits: task.estimatedCredits,
    userInstruction: trimmedInstruction || undefined,
    followUps: [],
  });

  if (excelFiles.length === 1) {
    const file = excelFiles[0]!;
    const buffer = await file.arrayBuffer();
    const workbook = dataEngine.parseFile(buffer, file.name);
    if (!workbook.sheets.length) {
      throw new StartDepartmentTaskError('未读取到有效工作表');
    }
    setCurrentFile(file.name);
    patch({
      importMode: 'excel',
      fileName: file.name,
      workbook,
    });
    navigate('/sheet');
    return;
  }

  const conversationId = `dept-${department.code}-${task.code}-${crypto.randomUUID()}`;

  if (nonExcelFiles.length > 0) {
    const fileIds: string[] = [];
    const names: string[] = [];
    for (const file of nonExcelFiles) {
      const uploaded = await uploadChatAttachment(file);
      fileIds.push(uploaded.fileId);
      names.push(file.name);
    }
    setCurrentFile(names.join('、'));
    patch({
      importMode: 'document',
      fileIds,
      uploadedFileId: fileIds[0],
      fileName: names.join('、'),
      conversationId,
    });
    navigate('/progress');
    return;
  }

  // 仅文字说明：走文档模式的 chat 分析
  setCurrentFile(null);
  patch({
    importMode: 'document',
    fileIds: [],
    uploadedFileId: undefined,
    fileName: undefined,
    conversationId,
  });
  navigate('/progress');
}
