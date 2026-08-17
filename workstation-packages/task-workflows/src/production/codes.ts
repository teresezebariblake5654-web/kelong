/** 统一生产办结任务代码（snake_case） */
export const PRODUCTION_WORKFLOW_CODES = [
  'material_daily_close',
  'material_variance_close',
  'production_plan_close',
  'output_attainment_close',
  'quality_exception_close',
  'downtime_loss_close',
] as const;

export type ProductionWorkflowCode = (typeof PRODUCTION_WORKFLOW_CODES)[number];

/** 与额度/模板目录兼容的 UPPER_SNAKE 代码 */
export const TEMPLATE_CODE_BY_WORKFLOW: Record<ProductionWorkflowCode, string> = {
  material_daily_close: 'PRODUCTION_MATERIAL_DAILY_CLOSE',
  material_variance_close: 'PRODUCTION_MATERIAL_VARIANCE_CLOSE',
  production_plan_close: 'PRODUCTION_PLAN_CLOSE',
  output_attainment_close: 'PRODUCTION_OUTPUT_ATTAINMENT_CLOSE',
  quality_exception_close: 'PRODUCTION_QUALITY_EXCEPTION_CLOSE',
  downtime_loss_close: 'PRODUCTION_DOWNTIME_LOSS_CLOSE',
};

export const WORKFLOW_BY_TEMPLATE_CODE: Record<string, ProductionWorkflowCode> = Object.fromEntries(
  Object.entries(TEMPLATE_CODE_BY_WORKFLOW).map(([wf, tpl]) => [tpl, wf as ProductionWorkflowCode]),
) as Record<string, ProductionWorkflowCode>;

/** 旧分析模板 → 新办结（兼容跳转） */
export const LEGACY_ANALYSIS_TO_CLOSE: Record<string, ProductionWorkflowCode> = {
  PRODUCTION_MATERIAL_VARIANCE: 'material_variance_close',
  PRODUCTION_SCHEDULE_PROGRESS: 'production_plan_close',
  PRODUCTION_OUTPUT_SUMMARY: 'output_attainment_close',
  PRODUCTION_QUALITY_ANALYSIS: 'quality_exception_close',
  PRODUCTION_DOWNTIME_ANALYSIS: 'downtime_loss_close',
  PRODUCTION_MATERIAL_DAILY_CLOSE: 'material_daily_close',
};

export function resolveProductionWorkflowCode(code: string): ProductionWorkflowCode | null {
  if ((PRODUCTION_WORKFLOW_CODES as readonly string[]).includes(code)) {
    return code as ProductionWorkflowCode;
  }
  if (WORKFLOW_BY_TEMPLATE_CODE[code]) return WORKFLOW_BY_TEMPLATE_CODE[code]!;
  if (LEGACY_ANALYSIS_TO_CLOSE[code]) return LEGACY_ANALYSIS_TO_CLOSE[code]!;
  return null;
}
