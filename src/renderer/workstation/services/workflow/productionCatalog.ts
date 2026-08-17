import type { WorkflowDefinition } from '@aw/shared';
import { listWorkflowDefinitions } from '@aw/task-templates';

export const PRODUCTION_WORKFLOW_IDS = [
  'PROD-MATERIAL-DAILY-001',
  'PROD-CONSUMPTION-CHECK-002',
  'PROD-PLAN-CLEAN-003',
  'PROD-PROGRESS-004',
  'PROD-QUALITY-005',
  'PROD-DOWNTIME-CLOSE-006',
] as const;

export type ProductionWorkflowId = (typeof PRODUCTION_WORKFLOW_IDS)[number];

const WORK_MODE_TO_WORKFLOW: Record<string, ProductionWorkflowId> = {
  'material-daily': 'PROD-MATERIAL-DAILY-001',
  'material-variance': 'PROD-CONSUMPTION-CHECK-002',
  'plan-close': 'PROD-PLAN-CLEAN-003',
  'progress-track': 'PROD-PROGRESS-004',
  'shortage-alert': 'PROD-QUALITY-005',
  'workorder-close': 'PROD-DOWNTIME-CLOSE-006',
  PRODUCTION_MATERIAL_DAILY_CLOSE: 'PROD-MATERIAL-DAILY-001',
  PRODUCTION_MATERIAL_VARIANCE_CLOSE: 'PROD-CONSUMPTION-CHECK-002',
  PRODUCTION_PLAN_CLOSE: 'PROD-PLAN-CLEAN-003',
  PRODUCTION_OUTPUT_ATTAINMENT_CLOSE: 'PROD-PROGRESS-004',
  PRODUCTION_QUALITY_EXCEPTION_CLOSE: 'PROD-QUALITY-005',
  PRODUCTION_DOWNTIME_LOSS_CLOSE: 'PROD-DOWNTIME-CLOSE-006',
  material_daily_close: 'PROD-MATERIAL-DAILY-001',
  material_variance_close: 'PROD-CONSUMPTION-CHECK-002',
  production_plan_close: 'PROD-PLAN-CLEAN-003',
  output_attainment_close: 'PROD-PROGRESS-004',
  quality_exception_close: 'PROD-QUALITY-005',
  downtime_loss_close: 'PROD-DOWNTIME-CLOSE-006',
};

export function isProductionWorkflowId(id: string): id is ProductionWorkflowId {
  return (PRODUCTION_WORKFLOW_IDS as readonly string[]).includes(id);
}

export function listProductionWorkflows(): WorkflowDefinition[] {
  const all = listWorkflowDefinitions({ category: 'production' });
  return PRODUCTION_WORKFLOW_IDS.map((id) => all.find((w) => w.id === id)).filter(
    (w): w is WorkflowDefinition => Boolean(w),
  );
}

export function resolveProductionWorkflowId(modeIdOrTemplateCode: string): ProductionWorkflowId | null {
  if (isProductionWorkflowId(modeIdOrTemplateCode)) return modeIdOrTemplateCode;
  return WORK_MODE_TO_WORKFLOW[modeIdOrTemplateCode] ?? null;
}
