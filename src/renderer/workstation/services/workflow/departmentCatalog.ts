import type { WorkflowCategory, WorkflowDefinition } from '@aw/shared';
import { listWorkflowDefinitions } from '@aw/task-templates';
import {
  PRODUCTION_WORKFLOW_IDS,
  isProductionWorkflowId,
  resolveProductionWorkflowId,
  type ProductionWorkflowId,
} from './productionCatalog';

export const HR_WORKFLOW_IDS = [
  'HR-PAYROLL-001',
  'HR-ATTENDANCE-002',
  'HR-EMPLOYEE-FILE-003',
  'HR-ONBOARD-OFFBOARD-004',
  'HR-SOCIAL-INSURANCE-005',
  'HR-RECRUITMENT-FUNNEL-006',
  'HR-PERFORMANCE-DISTRIBUTION-007',
] as const;

export const FINANCE_WORKFLOW_IDS = [
  'FIN-EXPENSE-CLEAN-001',
  'FIN-RECONCILIATION-002',
  'FIN-ARAP-003',
  'FIN-INVOICE-OCR-004',
  'FIN-OPERATING-SUMMARY-005',
] as const;

export const ECOMMERCE_WORKFLOW_IDS = [
  'ECOM-ORDER-CLEAN-001',
  'ECOM-REFUND-002',
  'ECOM-PRODUCT-DATA-003',
  'ECOM-LIVE-ORDER-004',
  'ECOM-SALES-SUMMARY-005',
] as const;

export const LOGISTICS_WORKFLOW_IDS = [
  'LOG-INVENTORY-COUNT-001',
  'LOG-INOUT-RECONCILE-002',
  'LOG-SHIPMENT-TRACK-003',
  'LOG-STOCK-ALERT-004',
  'LOG-TRANSFER-CLEAN-005',
] as const;

export const ADMIN_WORKFLOW_IDS = [
  'ADMIN-ASSET-INVENTORY-001',
  'ADMIN-EXPENSE-ANALYSIS-002',
  'ADMIN-ROOM-UTILIZATION-003',
  'ADMIN-CONTRACT-EXPIRY-004',
] as const;

export type HrWorkflowId = (typeof HR_WORKFLOW_IDS)[number];
export type FinanceWorkflowId = (typeof FINANCE_WORKFLOW_IDS)[number];
export type EcommerceWorkflowId = (typeof ECOMMERCE_WORKFLOW_IDS)[number];
export type LogisticsWorkflowId = (typeof LOGISTICS_WORKFLOW_IDS)[number];
export type AdminWorkflowId = (typeof ADMIN_WORKFLOW_IDS)[number];
export type DepartmentWorkflowCategory = Extract<
  WorkflowCategory,
  'production' | 'hr' | 'finance' | 'ecommerce' | 'logistics' | 'admin'
>;

export function catalogCategoryFromDepartmentCode(
  code: string,
): DepartmentWorkflowCategory | null {
  if (
    code === 'production' ||
    code === 'hr' ||
    code === 'finance' ||
    code === 'ecommerce' ||
    code === 'logistics'
  ) {
    return code;
  }
  if (code === 'administration' || code === 'admin') return 'admin';
  return null;
}

const HR_MODE_TO_WORKFLOW: Record<string, HrWorkflowId> = {
  payroll: 'HR-PAYROLL-001',
  attendance: 'HR-ATTENDANCE-002',
  archives: 'HR-EMPLOYEE-FILE-003',
  onboard: 'HR-ONBOARD-OFFBOARD-004',
  'social-security': 'HR-SOCIAL-INSURANCE-005',
  recruitment: 'HR-RECRUITMENT-FUNNEL-006',
  performance: 'HR-PERFORMANCE-DISTRIBUTION-007',
  HR_PAYROLL_VARIANCE: 'HR-PAYROLL-001',
  HR_ATTENDANCE_SUMMARY: 'HR-ATTENDANCE-002',
  HR_HEADCOUNT_SNAPSHOT: 'HR-EMPLOYEE-FILE-003',
  HR_TURNOVER_ANALYSIS: 'HR-ONBOARD-OFFBOARD-004',
  HR_SOCIAL_INSURANCE: 'HR-SOCIAL-INSURANCE-005',
  HR_RECRUITMENT_FUNNEL: 'HR-RECRUITMENT-FUNNEL-006',
  HR_PERFORMANCE_DISTRIBUTION: 'HR-PERFORMANCE-DISTRIBUTION-007',
  'HR-PAYROLL-001': 'HR-PAYROLL-001',
  'HR-ATTENDANCE-002': 'HR-ATTENDANCE-002',
  'HR-EMPLOYEE-FILE-003': 'HR-EMPLOYEE-FILE-003',
  'HR-ONBOARD-OFFBOARD-004': 'HR-ONBOARD-OFFBOARD-004',
  'HR-SOCIAL-INSURANCE-005': 'HR-SOCIAL-INSURANCE-005',
  'HR-RECRUITMENT-FUNNEL-006': 'HR-RECRUITMENT-FUNNEL-006',
  'HR-PERFORMANCE-DISTRIBUTION-007': 'HR-PERFORMANCE-DISTRIBUTION-007',
};

const FINANCE_MODE_TO_WORKFLOW: Record<string, FinanceWorkflowId> = {
  expense: 'FIN-EXPENSE-CLEAN-001',
  reconcile: 'FIN-RECONCILIATION-002',
  'ar-ap': 'FIN-ARAP-003',
  invoice: 'FIN-INVOICE-OCR-004',
  'ops-summary': 'FIN-OPERATING-SUMMARY-005',
  FIN_EXPENSE_CLEAN: 'FIN-EXPENSE-CLEAN-001',
  FIN_RECONCILIATION: 'FIN-RECONCILIATION-002',
  FIN_ARAP: 'FIN-ARAP-003',
  FIN_INVOICE_OCR: 'FIN-INVOICE-OCR-004',
  FIN_OPERATING_SUMMARY: 'FIN-OPERATING-SUMMARY-005',
  'FIN-EXPENSE-CLEAN-001': 'FIN-EXPENSE-CLEAN-001',
  'FIN-RECONCILIATION-002': 'FIN-RECONCILIATION-002',
  'FIN-ARAP-003': 'FIN-ARAP-003',
  'FIN-INVOICE-OCR-004': 'FIN-INVOICE-OCR-004',
  'FIN-OPERATING-SUMMARY-005': 'FIN-OPERATING-SUMMARY-005',
  费用整理: 'FIN-EXPENSE-CLEAN-001',
  对账核验: 'FIN-RECONCILIATION-002',
  应收应付: 'FIN-ARAP-003',
  发票识别: 'FIN-INVOICE-OCR-004',
  经营汇总: 'FIN-OPERATING-SUMMARY-005',
};

const ECOMMERCE_MODE_TO_WORKFLOW: Record<string, EcommerceWorkflowId> = {
  'order-clean': 'ECOM-ORDER-CLEAN-001',
  refund: 'ECOM-REFUND-002',
  'product-data': 'ECOM-PRODUCT-DATA-003',
  'live-orders': 'ECOM-LIVE-ORDER-004',
  'sales-summary': 'ECOM-SALES-SUMMARY-005',
  ECOM_ORDER_CLEAN: 'ECOM-ORDER-CLEAN-001',
  ECOM_REFUND: 'ECOM-REFUND-002',
  ECOM_PRODUCT_DATA: 'ECOM-PRODUCT-DATA-003',
  ECOM_LIVE_ORDER: 'ECOM-LIVE-ORDER-004',
  ECOM_SALES_SUMMARY: 'ECOM-SALES-SUMMARY-005',
  'ECOM-ORDER-CLEAN-001': 'ECOM-ORDER-CLEAN-001',
  'ECOM-REFUND-002': 'ECOM-REFUND-002',
  'ECOM-PRODUCT-DATA-003': 'ECOM-PRODUCT-DATA-003',
  'ECOM-LIVE-ORDER-004': 'ECOM-LIVE-ORDER-004',
  'ECOM-SALES-SUMMARY-005': 'ECOM-SALES-SUMMARY-005',
  订单清洗: 'ECOM-ORDER-CLEAN-001',
  退款异常: 'ECOM-REFUND-002',
  商品数据: 'ECOM-PRODUCT-DATA-003',
  直播订单: 'ECOM-LIVE-ORDER-004',
  销售汇总: 'ECOM-SALES-SUMMARY-005',
};

const LOGISTICS_MODE_TO_WORKFLOW: Record<string, LogisticsWorkflowId> = {
  inventory: 'LOG-INVENTORY-COUNT-001',
  inout: 'LOG-INOUT-RECONCILE-002',
  tracking: 'LOG-SHIPMENT-TRACK-003',
  'stock-alert': 'LOG-STOCK-ALERT-004',
  transfer: 'LOG-TRANSFER-CLEAN-005',
  LOG_INVENTORY_COUNT: 'LOG-INVENTORY-COUNT-001',
  LOG_INOUT_RECONCILE: 'LOG-INOUT-RECONCILE-002',
  LOG_SHIPMENT_TRACK: 'LOG-SHIPMENT-TRACK-003',
  LOG_STOCK_ALERT: 'LOG-STOCK-ALERT-004',
  LOG_TRANSFER_CLEAN: 'LOG-TRANSFER-CLEAN-005',
  'LOG-INVENTORY-COUNT-001': 'LOG-INVENTORY-COUNT-001',
  'LOG-INOUT-RECONCILE-002': 'LOG-INOUT-RECONCILE-002',
  'LOG-SHIPMENT-TRACK-003': 'LOG-SHIPMENT-TRACK-003',
  'LOG-STOCK-ALERT-004': 'LOG-STOCK-ALERT-004',
  'LOG-TRANSFER-CLEAN-005': 'LOG-TRANSFER-CLEAN-005',
  库存盘点: 'LOG-INVENTORY-COUNT-001',
  出入库核对: 'LOG-INOUT-RECONCILE-002',
  运单追踪: 'LOG-SHIPMENT-TRACK-003',
  库存预警: 'LOG-STOCK-ALERT-004',
  调拨整理: 'LOG-TRANSFER-CLEAN-005',
};

const ADMIN_MODE_TO_WORKFLOW: Record<string, AdminWorkflowId> = {
  asset: 'ADMIN-ASSET-INVENTORY-001',
  expense: 'ADMIN-EXPENSE-ANALYSIS-002',
  room: 'ADMIN-ROOM-UTILIZATION-003',
  contract: 'ADMIN-CONTRACT-EXPIRY-004',
  ADMIN_ASSET_INVENTORY: 'ADMIN-ASSET-INVENTORY-001',
  ADMIN_EXPENSE_ANALYSIS: 'ADMIN-EXPENSE-ANALYSIS-002',
  ADMIN_MEETING_UTILIZATION: 'ADMIN-ROOM-UTILIZATION-003',
  ADMIN_CONTRACT_EXPIRY: 'ADMIN-CONTRACT-EXPIRY-004',
  'ADMIN-ASSET-INVENTORY-001': 'ADMIN-ASSET-INVENTORY-001',
  'ADMIN-EXPENSE-ANALYSIS-002': 'ADMIN-EXPENSE-ANALYSIS-002',
  'ADMIN-ROOM-UTILIZATION-003': 'ADMIN-ROOM-UTILIZATION-003',
  'ADMIN-CONTRACT-EXPIRY-004': 'ADMIN-CONTRACT-EXPIRY-004',
  行政资产盘点: 'ADMIN-ASSET-INVENTORY-001',
  行政费用分析: 'ADMIN-EXPENSE-ANALYSIS-002',
  会议室利用率: 'ADMIN-ROOM-UTILIZATION-003',
  合同到期提醒: 'ADMIN-CONTRACT-EXPIRY-004',
};

const HIGH_RISK_HR = new Set<string>([
  'HR-PAYROLL-001',
  'HR-SOCIAL-INSURANCE-005',
  'HR-PERFORMANCE-DISTRIBUTION-007',
  'HR-ONBOARD-OFFBOARD-004',
]);

const HIGH_RISK_FINANCE = new Set<string>([
  'FIN-RECONCILIATION-002',
  'FIN-ARAP-003',
  'FIN-INVOICE-OCR-004',
  'FIN-OPERATING-SUMMARY-005',
]);

const HIGH_RISK_ECOMMERCE = new Set<string>([
  'ECOM-REFUND-002',
  'ECOM-LIVE-ORDER-004',
  'ECOM-SALES-SUMMARY-005',
]);

const HIGH_RISK_LOGISTICS = new Set<string>([
  'LOG-INVENTORY-COUNT-001',
  'LOG-INOUT-RECONCILE-002',
  'LOG-TRANSFER-CLEAN-005',
]);

const HIGH_RISK_ADMIN = new Set<string>([
  'ADMIN-ASSET-INVENTORY-001',
  'ADMIN-CONTRACT-EXPIRY-004',
]);

const MULTI_FILE_ROLES = new Set(['employee_files', 'invoice_files']);

export type SensitivityLevel = 'standard' | 'high' | 'critical';

export function isHrWorkflowId(id: string): id is HrWorkflowId {
  return (HR_WORKFLOW_IDS as readonly string[]).includes(id);
}

export function isFinanceWorkflowId(id: string): id is FinanceWorkflowId {
  return (FINANCE_WORKFLOW_IDS as readonly string[]).includes(id);
}

export function isEcommerceWorkflowId(id: string): id is EcommerceWorkflowId {
  return (ECOMMERCE_WORKFLOW_IDS as readonly string[]).includes(id);
}

export function isLogisticsWorkflowId(id: string): id is LogisticsWorkflowId {
  return (LOGISTICS_WORKFLOW_IDS as readonly string[]).includes(id);
}

export function isAdminWorkflowId(id: string): id is AdminWorkflowId {
  return (ADMIN_WORKFLOW_IDS as readonly string[]).includes(id);
}

export function listHrWorkflows(): WorkflowDefinition[] {
  const all = listWorkflowDefinitions({ category: 'hr' });
  return HR_WORKFLOW_IDS.map((id) => all.find((w) => w.id === id)).filter(
    (w): w is WorkflowDefinition => Boolean(w),
  );
}

export function listFinanceWorkflows(): WorkflowDefinition[] {
  const all = listWorkflowDefinitions({ category: 'finance' });
  return FINANCE_WORKFLOW_IDS.map((id) => all.find((w) => w.id === id)).filter(
    (w): w is WorkflowDefinition => Boolean(w),
  );
}

export function listEcommerceWorkflows(): WorkflowDefinition[] {
  const all = listWorkflowDefinitions({ category: 'ecommerce' });
  return ECOMMERCE_WORKFLOW_IDS.map((id) => all.find((w) => w.id === id)).filter(
    (w): w is WorkflowDefinition => Boolean(w),
  );
}

export function listLogisticsWorkflows(): WorkflowDefinition[] {
  const all = listWorkflowDefinitions({ category: 'logistics' });
  return LOGISTICS_WORKFLOW_IDS.map((id) => all.find((w) => w.id === id)).filter(
    (w): w is WorkflowDefinition => Boolean(w),
  );
}

export function listAdminWorkflows(): WorkflowDefinition[] {
  const all = listWorkflowDefinitions({ category: 'admin' });
  return ADMIN_WORKFLOW_IDS.map((id) => all.find((w) => w.id === id)).filter(
    (w): w is WorkflowDefinition => Boolean(w),
  );
}

export function listDepartmentWorkflows(category: DepartmentWorkflowCategory): WorkflowDefinition[] {
  if (category === 'production') {
    const all = listWorkflowDefinitions({ category: 'production' });
    return PRODUCTION_WORKFLOW_IDS.map((id) => all.find((w) => w.id === id)).filter(
      (w): w is WorkflowDefinition => Boolean(w),
    );
  }
  if (category === 'finance') return listFinanceWorkflows();
  if (category === 'ecommerce') return listEcommerceWorkflows();
  if (category === 'logistics') return listLogisticsWorkflows();
  if (category === 'admin') return listAdminWorkflows();
  return listHrWorkflows();
}

export function resolveHrWorkflowId(modeIdOrTemplateCode: string): HrWorkflowId | null {
  if (isHrWorkflowId(modeIdOrTemplateCode)) return modeIdOrTemplateCode;
  return HR_MODE_TO_WORKFLOW[modeIdOrTemplateCode] ?? null;
}

export function resolveFinanceWorkflowId(modeIdOrTemplateCode: string): FinanceWorkflowId | null {
  if (isFinanceWorkflowId(modeIdOrTemplateCode)) return modeIdOrTemplateCode;
  return FINANCE_MODE_TO_WORKFLOW[modeIdOrTemplateCode] ?? null;
}

export function resolveEcommerceWorkflowId(
  modeIdOrTemplateCode: string,
): EcommerceWorkflowId | null {
  if (isEcommerceWorkflowId(modeIdOrTemplateCode)) return modeIdOrTemplateCode;
  return ECOMMERCE_MODE_TO_WORKFLOW[modeIdOrTemplateCode] ?? null;
}

export function resolveLogisticsWorkflowId(
  modeIdOrTemplateCode: string,
): LogisticsWorkflowId | null {
  if (isLogisticsWorkflowId(modeIdOrTemplateCode)) return modeIdOrTemplateCode;
  return LOGISTICS_MODE_TO_WORKFLOW[modeIdOrTemplateCode] ?? null;
}

export function resolveAdminWorkflowId(modeIdOrTemplateCode: string): AdminWorkflowId | null {
  if (isAdminWorkflowId(modeIdOrTemplateCode)) return modeIdOrTemplateCode;
  return ADMIN_MODE_TO_WORKFLOW[modeIdOrTemplateCode] ?? null;
}

export function resolveDepartmentWorkflowId(
  category: DepartmentWorkflowCategory | string,
  modeIdOrTemplateCode: string,
): string | null {
  if (category === 'hr') return resolveHrWorkflowId(modeIdOrTemplateCode);
  if (category === 'production') return resolveProductionWorkflowId(modeIdOrTemplateCode);
  if (category === 'finance') return resolveFinanceWorkflowId(modeIdOrTemplateCode);
  if (category === 'ecommerce') return resolveEcommerceWorkflowId(modeIdOrTemplateCode);
  if (category === 'logistics') return resolveLogisticsWorkflowId(modeIdOrTemplateCode);
  if (category === 'admin') return resolveAdminWorkflowId(modeIdOrTemplateCode);
  return (
    resolveAdminWorkflowId(modeIdOrTemplateCode) ??
    resolveLogisticsWorkflowId(modeIdOrTemplateCode) ??
    resolveEcommerceWorkflowId(modeIdOrTemplateCode) ??
    resolveFinanceWorkflowId(modeIdOrTemplateCode) ??
    resolveHrWorkflowId(modeIdOrTemplateCode) ??
    resolveProductionWorkflowId(modeIdOrTemplateCode)
  );
}

export function isDepartmentCatalogWorkflowId(id: string): boolean {
  return (
    isProductionWorkflowId(id) ||
    isHrWorkflowId(id) ||
    isFinanceWorkflowId(id) ||
    isEcommerceWorkflowId(id) ||
    isLogisticsWorkflowId(id) ||
    isAdminWorkflowId(id)
  );
}

export function departmentHomePath(category: DepartmentWorkflowCategory): string {
  if (category === 'hr') return '/hr/workflows';
  if (category === 'finance') return '/finance/workflows';
  if (category === 'ecommerce') return '/ecommerce/workflows';
  if (category === 'logistics') return '/logistics/workflows';
  if (category === 'admin') return '/admin/workflows';
  return '/production/workflows';
}

export function departmentRunPath(category: DepartmentWorkflowCategory, workflowId: string): string {
  return `${departmentHomePath(category)}/${workflowId}`;
}

export function departmentCategoryFromWorkflowId(
  workflowId: string,
): DepartmentWorkflowCategory | null {
  if (isHrWorkflowId(workflowId)) return 'hr';
  if (isProductionWorkflowId(workflowId)) return 'production';
  if (isFinanceWorkflowId(workflowId)) return 'finance';
  if (isEcommerceWorkflowId(workflowId)) return 'ecommerce';
  if (isLogisticsWorkflowId(workflowId)) return 'logistics';
  if (isAdminWorkflowId(workflowId)) return 'admin';
  return null;
}

export function isHighRiskWorkflow(definition: WorkflowDefinition): boolean {
  if (definition.id.startsWith('FIN-')) {
    return HIGH_RISK_FINANCE.has(definition.id);
  }
  if (definition.id.startsWith('ECOM-')) {
    return HIGH_RISK_ECOMMERCE.has(definition.id);
  }
  if (definition.id.startsWith('LOG-')) {
    return HIGH_RISK_LOGISTICS.has(definition.id);
  }
  if (definition.id.startsWith('ADMIN-')) {
    return HIGH_RISK_ADMIN.has(definition.id);
  }
  if (HIGH_RISK_HR.has(definition.id)) return true;
  return (
    definition.manualReviewTriggers.length > 0 ||
    definition.complexity === 'high' ||
    definition.complexity === 'very_high'
  );
}

/** Alias for production UI / older imports — same logic as `isHighRiskWorkflow`. */
export function isHighRiskManualReview(definition: WorkflowDefinition): boolean {
  return isHighRiskWorkflow(definition);
}

export function sensitivityLevel(definition: WorkflowDefinition): SensitivityLevel {
  if (definition.id.startsWith('HR-PAYROLL') || definition.id.startsWith('HR-SOCIAL')) {
    return 'critical';
  }
  if (definition.id.startsWith('FIN-')) return 'high';
  if (definition.id.startsWith('ECOM-REFUND') || definition.id.startsWith('ECOM-SALES')) {
    return 'high';
  }
  if (definition.id.startsWith('LOG-INVENTORY') || definition.id.startsWith('LOG-INOUT')) {
    return 'high';
  }
  if (definition.id.startsWith('ADMIN-ASSET') || definition.id.startsWith('ADMIN-CONTRACT')) {
    return 'high';
  }
  if (definition.id.startsWith('HR-')) return 'high';
  return 'standard';
}

export function sensitivityLabel(level: SensitivityLevel): string {
  if (level === 'critical') return '极高敏感';
  if (level === 'high') return '高敏感';
  return '标准';
}

export function roleAllowsMultipleFiles(role: string): boolean {
  return MULTI_FILE_ROLES.has(role) || role.endsWith('_files');
}

export function requiredInputCount(definition: WorkflowDefinition): number {
  return definition.inputRoles.filter((r) => r.required).length;
}

export function optionalInputCount(definition: WorkflowDefinition): number {
  return definition.inputRoles.filter((r) => !r.required).length;
}

export function sampleOutputFileName(definition: WorkflowDefinition): string {
  return definition.output.fileNameTemplate
    .replace('{runDate}', 'YYYY-MM-DD')
    .replace('{payMonth}', 'YYYY-MM')
    .replace('{month}', 'YYYY-MM')
    .replace('{period}', 'YYYY-MM')
    .replace('{cycle}', '周期');
}

export function financeDisclaimer(workflowId: string): string | null {
  if (workflowId === 'FIN-EXPENSE-CLEAN-001') {
    return '只整理费用与异常，不自动记账/审批/付款。';
  }
  if (workflowId === 'FIN-RECONCILIATION-002') {
    return '只生成对账建议，不自动改账务或银行记录。';
  }
  if (workflowId === 'FIN-ARAP-003') {
    return '只输出应收应付分析，不自动催收/付款/核销。';
  }
  if (workflowId === 'FIN-INVOICE-OCR-004') {
    return '只做发票结构化校验；未装本地 OCR 时引导人工录入，不自动认证或入账。';
  }
  if (workflowId === 'FIN-OPERATING-SUMMARY-005') {
    return '只生成本地经营汇总，不自动记账或上报。';
  }
  return null;
}

export function ecommerceDisclaimer(workflowId: string): string | null {
  if (workflowId === 'ECOM-ORDER-CLEAN-001') {
    return '只给出可发货建议，不自动发货或改单。';
  }
  if (workflowId === 'ECOM-REFUND-002') {
    return '只核验退款异常，不自动退款/退货入库。';
  }
  if (workflowId === 'ECOM-PRODUCT-DATA-003') {
    return '只诊断商品数据问题，不自动改价或上下架。';
  }
  if (workflowId === 'ECOM-LIVE-ORDER-004') {
    return '只标记超卖与异常，不自动取消直播订单。';
  }
  if (workflowId === 'ECOM-SALES-SUMMARY-005') {
    return '只生成本地销售汇总，不自动上报或调账。';
  }
  return null;
}

export function logisticsDisclaimer(workflowId: string): string | null {
  if (workflowId === 'LOG-INVENTORY-COUNT-001') {
    return '只输出盘点差异建议，不自动调整库存或回写 WMS。';
  }
  if (workflowId === 'LOG-INOUT-RECONCILE-002') {
    return '只核对出入库差异，不自动过账或改库存。';
  }
  if (workflowId === 'LOG-SHIPMENT-TRACK-003') {
    return '只输出运单追踪建议，不自动取消或发货运单。';
  }
  if (workflowId === 'LOG-STOCK-ALERT-004') {
    return '只做库存预警，不自动补货、调拨或改库存。';
  }
  if (workflowId === 'LOG-TRANSFER-CLEAN-005') {
    return '只整理调拨异常，不自动完成调拨或改库存。';
  }
  return null;
}

export function adminDisclaimer(workflowId: string): string | null {
  if (workflowId === 'ADMIN-ASSET-INVENTORY-001') {
    return '只诊断资产盘点差异，不自动更新资产台账。';
  }
  if (workflowId === 'ADMIN-EXPENSE-ANALYSIS-002') {
    return '只分析行政费用异常，不自动处置或记账。';
  }
  if (workflowId === 'ADMIN-ROOM-UTILIZATION-003') {
    return '只统计会议室利用率，不自动改预订或释放房间。';
  }
  if (workflowId === 'ADMIN-CONTRACT-EXPIRY-004') {
    return '只提醒合同到期，不自动续约或终止。';
  }
  return null;
}

export function productionDisclaimer(workflowId: string): string | null {
  if (workflowId === 'PROD-MATERIAL-DAILY-001') {
    return '只核算物料日清差异，不自动调整库存或回写 ERP。';
  }
  if (workflowId === 'PROD-CONSUMPTION-CHECK-002') {
    return '只核对物料消耗异常，不自动改 BOM、补扣料或冲账。';
  }
  if (workflowId === 'PROD-PLAN-CLEAN-003') {
    return '只输出可执行计划建议，不自动下发工单或改 ERP 计划。';
  }
  if (workflowId === 'PROD-PROGRESS-004') {
    return '只统计进度与延期风险，不自动改报工或结案。';
  }
  if (workflowId === 'PROD-QUALITY-005') {
    return '只识别质量异常与隔离建议，不自动报废、返工或放行。';
  }
  if (workflowId === 'PROD-DOWNTIME-CLOSE-006') {
    return '只检查结案条件与停机损失，不自动结案或改产量。';
  }
  return null;
}

export function hrDisclaimer(workflowId: string): string | null {
  if (workflowId === 'HR-PAYROLL-001') {
    return '只生成工资与发薪建议，不自动发薪、扣款或过账。';
  }
  if (workflowId === 'HR-ATTENDANCE-002') {
    return '只识别考勤异常，不自动改考勤记录或扣款。';
  }
  if (workflowId === 'HR-EMPLOYEE-FILE-003') {
    return '只整理档案差异与到期提醒，不自动覆盖人事主数据。';
  }
  if (workflowId === 'HR-ONBOARD-OFFBOARD-004') {
    return '只生成入离职任务清单，不自动开通/关闭账号或处置资产。';
  }
  if (workflowId === 'HR-SOCIAL-INSURANCE-005') {
    return '只核验社保公积金差异，不自动申报、缴费或扣款。';
  }
  if (workflowId === 'HR-RECRUITMENT-FUNNEL-006') {
    return '只分析招聘漏斗与停滞，不自动推进候选人阶段。';
  }
  if (workflowId === 'HR-PERFORMANCE-DISTRIBUTION-007') {
    return '只输出绩效校准建议，不自动改绩效结果或评级。';
  }
  return null;
}

/** 统一免责协议：所有智能体运行页/列表共用 */
export function workflowDisclaimer(workflowId: string): string | null {
  return (
    productionDisclaimer(workflowId) ??
    hrDisclaimer(workflowId) ??
    financeDisclaimer(workflowId) ??
    ecommerceDisclaimer(workflowId) ??
    logisticsDisclaimer(workflowId) ??
    adminDisclaimer(workflowId)
  );
}

export type { ProductionWorkflowId };
export { PRODUCTION_WORKFLOW_IDS, isProductionWorkflowId, resolveProductionWorkflowId };
