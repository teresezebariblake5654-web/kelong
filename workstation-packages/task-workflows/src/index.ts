/**
 * 办结工作流包（与 @aw/task-templates 分析模板分离）
 * - task-templates：岗位分析模板目录 / 额度 / AI 摘要元数据
 * - task-workflows：可执行办结流水线（认表 → 规范化 → 规则日清 → 出单据）
 */
export * from './production/material-daily-close/index.js';
export * from './production/codes.js';
export {
  ProductionWorkflowRegistry,
  runProductionWorkflow,
  buildProductionDeliverables,
  recomputeWithActions,
  type ProductionWorkflowDefinition,
} from './production/registry.js';
export type { AiAllowedOperation as ProductionAiAllowedOperation } from './production/registry.js';
export * from './production/db/workspaceDbManager.js';
export * from './production/db/productionRepository.js';
export * from './production/db/productionSchema.js';
export type {
  ProductionInputSlot,
  ProductionException,
  ProductionExceptionAction,
  AppliedProductionAction,
  ProductionDeliverable,
  ProductionWorkflowResult,
  RawWorkbook,
  RunProductionWorkflowInput,
} from './production/shared/types.js';
