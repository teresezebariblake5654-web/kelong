import { runMaterialCalcEngine } from './calcEngine.js';
import type { MaterialDailyBalanceLine, StandardMaterialRow } from './types.js';

export { buildMergeKey, parseQuantity, runMaterialCalcEngine } from './calcEngine.js';

/** 兼容旧签名：仅返回结存行 */
export function runDailyCloseRules(rows: StandardMaterialRow[]): MaterialDailyBalanceLine[] {
  return runMaterialCalcEngine(rows).balances;
}
