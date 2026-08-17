import { ADMINISTRATION_TASK_TEMPLATES } from './administration/index.js';
import { CUSTOMER_SERVICE_TASK_TEMPLATES } from './customer-service/index.js';
import { PRODUCT_ROLE_ACCESS } from './define.js';
import { HR_TASK_TEMPLATES } from './hr/index.js';
import { LOGISTICS_TASK_TEMPLATES } from './logistics/index.js';
import { MARKETING_TASK_TEMPLATES } from './marketing/index.js';
import { OPERATIONS_TASK_TEMPLATES } from './operations/index.js';
import { PROCUREMENT_TASK_TEMPLATES } from './procurement/index.js';
import { PRODUCTION_TASK_TEMPLATES } from './production/index.js';
import { SALES_TASK_TEMPLATES } from './sales/index.js';
import type { AgentRole, LicenseProductType, LocalTaskTemplate } from './types.js';
import { UNIVERSAL_TASK_TEMPLATES } from './universal/index.js';

export * from './types.js';
export { PRODUCT_ROLE_ACCESS, productsForRole } from './define.js';
export * from './workflows/index.js';

export const LOCAL_TASK_TEMPLATES: LocalTaskTemplate[] = [
  ...HR_TASK_TEMPLATES,
  ...MARKETING_TASK_TEMPLATES,
  ...SALES_TASK_TEMPLATES,
  ...OPERATIONS_TASK_TEMPLATES,
  ...ADMINISTRATION_TASK_TEMPLATES,
  ...PROCUREMENT_TASK_TEMPLATES,
  ...PRODUCTION_TASK_TEMPLATES,
  ...LOGISTICS_TASK_TEMPLATES,
  ...CUSTOMER_SERVICE_TASK_TEMPLATES,
  ...UNIVERSAL_TASK_TEMPLATES,
];

export const TASK_TEMPLATE_DEFINITIONS = LOCAL_TASK_TEMPLATES;

export function listTasksByRole(role: AgentRole): LocalTaskTemplate[] {
  return LOCAL_TASK_TEMPLATES.filter((task) => task.role === role);
}

export function listTasksByProduct(productType: LicenseProductType): LocalTaskTemplate[] {
  const roles = PRODUCT_ROLE_ACCESS[productType];
  return LOCAL_TASK_TEMPLATES.filter((task) => roles.includes(task.role));
}

export function getTaskTemplate(code: string, version = '1.0.0'): LocalTaskTemplate | undefined {
  return LOCAL_TASK_TEMPLATES.find((task) => task.code === code && task.version === version);
}
