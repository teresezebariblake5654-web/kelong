import { DEFAULT_ENTERPRISE_RULES } from './enterpriseRules.js';
import { evaluateBusinessRules } from './businessRules.js';
import type { MaterialDailyBalanceLine, MaterialException, StandardMaterialRow } from './types.js';

/** 兼容旧签名 */
export function detectExceptions(
  balances: MaterialDailyBalanceLine[],
  sourceRows: StandardMaterialRow[],
): MaterialException[] {
  return evaluateBusinessRules({
    balances,
    details: [],
    sourceRows,
    rules: DEFAULT_ENTERPRISE_RULES,
  });
}

export { evaluateBusinessRules } from './businessRules.js';
