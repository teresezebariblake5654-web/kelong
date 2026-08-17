import type { DataRow } from '../../types.js';
import { asText, parseNumeric } from './fieldUtils.js';

export type PriorityRule = 'DUE_DATE' | 'CUSTOMER_PRIORITY_THEN_DUE_DATE';

/**
 * Deterministic plan comparator. Same inputs always produce the same order.
 * Priority: overdue → customerPriority (optional) → dueDate → plannedStartDate → planNo → productCode
 */
export function compareProductionPlans(
  a: DataRow,
  b: DataRow,
  options?: { priorityRule?: PriorityRule },
): number {
  const priorityRule = options?.priorityRule ?? 'DUE_DATE';

  const overdueA = Boolean(a.overdue) ? 1 : 0;
  const overdueB = Boolean(b.overdue) ? 1 : 0;
  if (overdueA !== overdueB) return overdueB - overdueA;

  if (priorityRule === 'CUSTOMER_PRIORITY_THEN_DUE_DATE') {
    const pa = parseNumeric(a.customerPriority) ?? Number.NEGATIVE_INFINITY;
    const pb = parseNumeric(b.customerPriority) ?? Number.NEGATIVE_INFINITY;
    if (pa !== pb) return pb - pa;
  }

  const dueCmp = asText(a.dueDate).localeCompare(asText(b.dueDate));
  if (dueCmp !== 0) return dueCmp;

  const startCmp = asText(a.plannedStartDate).localeCompare(asText(b.plannedStartDate));
  if (startCmp !== 0) return startCmp;

  const planCmp = asText(a.planNo).localeCompare(asText(b.planNo), 'en');
  if (planCmp !== 0) return planCmp;

  return asText(a.productCode).localeCompare(asText(b.productCode), 'en');
}

export function sortProductionPlans(
  rows: DataRow[],
  options?: { priorityRule?: PriorityRule },
): DataRow[] {
  return [...rows].sort((a, b) => compareProductionPlans(a, b, options));
}
