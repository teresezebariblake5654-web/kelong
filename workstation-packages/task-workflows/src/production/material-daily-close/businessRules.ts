import { resolveSafetyStock, type EnterpriseRules } from './enterpriseRules.js';
import type {
  MaterialCalcDetail,
  MaterialDailyBalanceLine,
  MaterialException,
  StandardMaterialRow,
} from './types.js';

const EPS = 1e-9;

export type BusinessRuleCode =
  | 'NEGATIVE_INVENTORY'
  | 'LOW_STOCK'
  | 'MATERIAL_SHORTAGE'
  | 'EXCESSIVE_SCRAP'
  | 'EXCESSIVE_ISSUE'
  | 'INVALID_RETURN'
  | 'UNIT_CONFLICT'
  | 'MISSING_REQUIRED_FIELD'
  | 'DUPLICATE_TRANSACTION'
  | 'COUNT_DIFFERENCE';

/**
 * 第一版业务规则（确定性，非 AI）
 */
export function evaluateBusinessRules(input: {
  balances: MaterialDailyBalanceLine[];
  details: MaterialCalcDetail[];
  sourceRows: StandardMaterialRow[];
  rules: EnterpriseRules;
  normalizeErrors?: string[];
}): MaterialException[] {
  const { balances, details, sourceRows, rules } = input;
  const exceptions: MaterialException[] = [];
  const tolerance = rules.quantityTolerance;

  for (const err of input.normalizeErrors ?? []) {
    exceptions.push({
      code: 'MISSING_REQUIRED_FIELD',
      severity: 'warning',
      message: err,
    });
  }

  for (const detail of details) {
    if (detail.unitCandidates.length > 1) {
      exceptions.push({
        code: 'UNIT_CONFLICT',
        severity: 'critical',
        message: `同一物料出现多种单位：${detail.unitCandidates.join(' / ')}`,
        materialCode: detail.materialCode,
        materialName: detail.materialName,
        warehouse: detail.warehouse,
      });
    }
    if (detail.materialCodeCandidates.length > 1) {
      exceptions.push({
        code: 'MISSING_REQUIRED_FIELD',
        severity: 'warning',
        message: `同名物料对应多个编码：${detail.materialCodeCandidates.join('、')}`,
        materialName: detail.materialName,
        warehouse: detail.warehouse,
      });
    }
    if (detail.duplicateSourceCount > 0) {
      exceptions.push({
        code: 'DUPLICATE_TRANSACTION',
        severity: 'warning',
        message: `检测到 ${detail.duplicateSourceCount} 条重复交易行（已按明细累计，请复核）`,
        materialCode: detail.materialCode,
        materialName: detail.materialName,
        warehouse: detail.warehouse,
        value: detail.duplicateSourceCount,
      });
    }
  }

  for (const line of balances) {
    const closing = line.closingQuantity ?? line.theoreticalQuantity;

    if (closing < -tolerance) {
      exceptions.push({
        code: 'NEGATIVE_INVENTORY',
        severity: 'critical',
        message: `结存小于 0（${closing} ${line.unit}）`,
        materialCode: line.materialCode,
        materialName: line.materialName,
        warehouse: line.warehouse,
        value: closing,
      });
    }

    const safety = resolveSafetyStock(rules, line.materialCode, line.materialName);
    if (safety > 0 && closing + EPS < safety) {
      exceptions.push({
        code: 'LOW_STOCK',
        severity: 'warning',
        message: `结存 ${closing} 低于安全库存 ${safety}`,
        materialCode: line.materialCode,
        materialName: line.materialName,
        warehouse: line.warehouse,
        value: closing,
      });
    }

    if (line.plannedQuantity > EPS && line.plannedQuantity > closing + tolerance) {
      exceptions.push({
        code: 'MATERIAL_SHORTAGE',
        severity: 'critical',
        message: `计划需求 ${line.plannedQuantity} 大于可用库存 ${closing}`,
        materialCode: line.materialCode,
        materialName: line.materialName,
        warehouse: line.warehouse,
        value: line.plannedQuantity - closing,
      });
    }

    if (line.issuedQuantity > EPS) {
      const scrapRatio = line.scrapQuantity / line.issuedQuantity;
      if (scrapRatio > rules.scrapRatioThreshold + EPS) {
        exceptions.push({
          code: 'EXCESSIVE_SCRAP',
          severity: 'warning',
          message: `报废比例 ${(scrapRatio * 100).toFixed(1)}% 超过阈值 ${(rules.scrapRatioThreshold * 100).toFixed(1)}%`,
          materialCode: line.materialCode,
          materialName: line.materialName,
          warehouse: line.warehouse,
          value: scrapRatio,
        });
      }
    }

    if (line.plannedQuantity > EPS && line.issuedQuantity > line.plannedQuantity * 1.2 + tolerance) {
      exceptions.push({
        code: 'EXCESSIVE_ISSUE',
        severity: 'warning',
        message: `领料 ${line.issuedQuantity} 明显超过计划需求 ${line.plannedQuantity}`,
        materialCode: line.materialCode,
        materialName: line.materialName,
        warehouse: line.warehouse,
        value: line.issuedQuantity,
      });
    }

    if (line.returnedQuantity > line.issuedQuantity + tolerance) {
      exceptions.push({
        code: 'INVALID_RETURN',
        severity: 'critical',
        message: `退料 ${line.returnedQuantity} 大于领料 ${line.issuedQuantity}`,
        materialCode: line.materialCode,
        materialName: line.materialName,
        warehouse: line.warehouse,
        value: line.returnedQuantity,
      });
    }

    if (
      line.countedQuantity !== null &&
      line.varianceQuantity !== null &&
      Math.abs(line.varianceQuantity) > tolerance
    ) {
      exceptions.push({
        code: 'COUNT_DIFFERENCE',
        severity: Math.abs(line.varianceQuantity) > tolerance * 10 ? 'critical' : 'warning',
        message: `实盘 ${line.countedQuantity} 与账面结存 ${closing} 不一致（差 ${line.varianceQuantity}）`,
        materialCode: line.materialCode,
        materialName: line.materialName,
        warehouse: line.warehouse,
        value: line.varianceQuantity,
      });
    }
  }

  const missingIdentity = sourceRows.filter((row) => !row.materialName && !row.materialCode);
  if (missingIdentity.length) {
    exceptions.push({
      code: 'MISSING_REQUIRED_FIELD',
      severity: 'warning',
      message: `${missingIdentity.length} 行缺少物料名称/编码`,
      value: missingIdentity.length,
    });
  }

  return exceptions;
}
