import { evaluateBusinessRules } from './businessRules.js';
import type { EnterpriseRules } from './enterpriseRules.js';
import { resolveSafetyStock } from './enterpriseRules.js';
import { buildReplenishTickets, buildScrapTickets, buildVarianceTickets } from './outputBuilder.js';
import type {
  MaterialCalcDetail,
  MaterialDailyBalanceLine,
  MaterialDailyCloseWorkflowResult,
  MaterialException,
  StandardMaterialRow,
} from './types.js';

/** 用户对业务异常的可执行动作（禁止暴露技术错误） */
export type ExceptionUserAction =
  | 'confirm_scrap'
  | 'ignore_once'
  | 'modify_quantity'
  | 'select_unit'
  | 'mark_manual';

export type ExceptionActionOption = {
  action: ExceptionUserAction;
  label: string;
  needsValue?: boolean;
  valueHint?: string;
};

export type AppliedExceptionAction = {
  exceptionKey: string;
  code: string;
  materialCode?: string;
  materialName?: string;
  warehouse?: string;
  action: ExceptionUserAction;
  value?: string | number;
  resolvedAt: string;
};

export function exceptionBusinessKey(exc: MaterialException): string {
  return [
    exc.code,
    exc.materialCode ?? '',
    exc.materialName ?? '',
    exc.warehouse ?? '',
    exc.value ?? '',
  ].join('|');
}

/** 按业务异常码提供明确选项 */
export function optionsForException(code: string): ExceptionActionOption[] {
  switch (code) {
    case 'EXCESSIVE_SCRAP':
      return [
        { action: 'confirm_scrap', label: '确认报废' },
        { action: 'ignore_once', label: '忽略本次' },
        { action: 'modify_quantity', label: '修改数量', needsValue: true, valueHint: '报废数量' },
        { action: 'mark_manual', label: '标记人工处理' },
      ];
    case 'UNIT_CONFLICT':
      return [
        { action: 'select_unit', label: '选择正确单位', needsValue: true, valueHint: '单位' },
        { action: 'mark_manual', label: '标记人工处理' },
      ];
    case 'NEGATIVE_INVENTORY':
    case 'MATERIAL_SHORTAGE':
    case 'COUNT_DIFFERENCE':
      return [
        { action: 'modify_quantity', label: '修改数量', needsValue: true, valueHint: '调整后数量' },
        { action: 'ignore_once', label: '忽略本次' },
        { action: 'mark_manual', label: '标记人工处理' },
      ];
    case 'DUPLICATE_TRANSACTION':
    case 'LOW_STOCK':
    case 'EXCESSIVE_ISSUE':
    case 'INVALID_RETURN':
    default:
      return [
        { action: 'ignore_once', label: '忽略本次' },
        { action: 'mark_manual', label: '标记人工处理' },
        { action: 'modify_quantity', label: '修改数量', needsValue: true, valueHint: '数量' },
      ];
  }
}

/** 将技术/内部异常过滤为业务可见文案 */
export function toBusinessFacingException(exc: MaterialException): MaterialException | null {
  const technical = /SQL|Token|stack|TypeError|undefined|null is not|fetch|HTTP|model|DeepSeek/i;
  if (technical.test(exc.message)) return null;
  return exc;
}

function lineMatches(line: MaterialDailyBalanceLine, action: AppliedExceptionAction): boolean {
  if (action.materialCode && line.materialCode !== action.materialCode) return false;
  if (action.materialName && line.materialName !== action.materialName) return false;
  if (action.warehouse && line.warehouse !== action.warehouse) return false;
  return Boolean(action.materialCode || action.materialName);
}

/**
 * 应用用户确认后实时重算结存/单据/异常（仍为确定性计算，AI 不参与数量）。
 */
export function applyExceptionActionsAndRecompute(input: {
  result: MaterialDailyCloseWorkflowResult;
  actions: AppliedExceptionAction[];
  rules: EnterpriseRules;
  sourceRows?: StandardMaterialRow[];
}): MaterialDailyCloseWorkflowResult {
  const { result, actions, rules } = input;
  let balances = result.balances.map((b) => ({ ...b }));
  let details = (result.calcDetails ?? []).map((d) => ({ ...d }));

  const resolvedKeys = new Set<string>();
  const manualKeys = new Set<string>();
  const scrapConfirmed = new Set<string>();

  for (const action of actions) {
    resolvedKeys.add(action.exceptionKey);
    if (action.action === 'mark_manual') {
      manualKeys.add(action.exceptionKey);
      continue;
    }
    if (action.action === 'ignore_once') continue;

    balances = balances.map((line) => {
      if (!lineMatches(line, action)) return line;
      const next = { ...line };
      if (action.action === 'select_unit' && action.value != null) {
        next.unit = String(action.value);
      }
      if (action.action === 'modify_quantity' && action.value != null) {
        const qty = Number(action.value);
        if (Number.isFinite(qty)) {
          if (action.code === 'EXCESSIVE_SCRAP') {
            next.scrapQuantity = qty;
            const closing =
              next.openingQuantity +
              next.inboundQuantity +
              next.returnedQuantity -
              next.issuedQuantity -
              next.scrapQuantity;
            next.closingQuantity = closing;
            next.theoreticalQuantity = closing;
          } else if (action.code === 'NEGATIVE_INVENTORY' || action.code === 'MATERIAL_SHORTAGE') {
            next.closingQuantity = qty;
            next.theoreticalQuantity = qty;
          } else if (action.code === 'COUNT_DIFFERENCE') {
            next.countedQuantity = qty;
            const closing = next.closingQuantity ?? next.theoreticalQuantity;
            next.varianceQuantity = qty - closing;
            next.replenishQuantity = next.varianceQuantity < 0 ? Math.abs(next.varianceQuantity) : 0;
          } else {
            next.closingQuantity = qty;
            next.theoreticalQuantity = qty;
          }
        }
      }
      if (action.action === 'confirm_scrap') {
        scrapConfirmed.add(`${next.materialCode}|${next.warehouse}`);
      }
      return next;
    });

    details = details.map((detail) => {
      if (action.materialCode && detail.materialCode !== action.materialCode) return detail;
      if (action.materialName && detail.materialName !== action.materialName) return detail;
      if (action.warehouse && detail.warehouse !== action.warehouse) return detail;
      if (action.action === 'select_unit' && action.value != null) {
        return { ...detail, unit: String(action.value), unitCandidates: [String(action.value)] };
      }
      return detail;
    });
  }

  // 忽略的异常不再展示；已确认报废保留在报废单并标注
  let exceptions = evaluateBusinessRules({
    balances,
    details,
    sourceRows: input.sourceRows ?? [],
    rules,
  }).filter((exc) => {
    const key = exceptionBusinessKey(exc);
    if (resolvedKeys.has(key)) return false;
    // 宽松匹配：同物料+同码的 ignore/confirm 也过滤
    for (const action of actions) {
      if (action.code !== exc.code) continue;
      if (action.materialCode && action.materialCode !== (exc.materialCode ?? '')) continue;
      if (action.warehouse && action.warehouse !== (exc.warehouse ?? '')) continue;
      if (action.action === 'ignore_once' || action.action === 'confirm_scrap') return false;
      if (action.action === 'mark_manual') return false;
    }
    return toBusinessFacingException(exc) != null;
  });

  exceptions = exceptions
    .map(toBusinessFacingException)
    .filter((item): item is MaterialException => Boolean(item));

  const replenishTickets = buildReplenishTickets(balances);
  const scrapTickets = buildScrapTickets(balances).map((row) => {
    const key = `${row['物料编码']}|${row['仓库']}`;
    const next = {
      ...row,
      AI分类: String(row['备注'] ?? '').includes('废') ? '疑似报废' : '待分类',
      人工确认状态: scrapConfirmed.has(key) ? '已确认报废' : '待确认',
    };
    return next;
  });
  const varianceTickets = buildVarianceTickets(balances);

  const autoClosed = Math.max(0, balances.length - exceptions.length - manualKeys.size);
  const summary = {
    ...result.summary,
    balanceRows: balances.length,
    replenishCount: replenishTickets.length,
    scrapTicketCount: scrapTickets.length,
    varianceCount: varianceTickets.length,
    totalReplenishQty: roundSum(replenishTickets.map((r) => Number(r['建议补料数量'] ?? 0))),
    totalScrapQty: roundSum(
      scrapTickets.map((r) => Number((r as Record<string, string | number>)['废料数量'] ?? (r as Record<string, string | number>)['报废数量'] ?? 0)),
    ),
    totalShortageQty: roundSum(
      balances.filter((b) => (b.varianceQuantity ?? 0) < 0).map((b) => Math.abs(b.varianceQuantity ?? 0)),
    ),
    totalOverageQty: roundSum(
      balances.filter((b) => (b.varianceQuantity ?? 0) > 0).map((b) => b.varianceQuantity ?? 0),
    ),
    processedRecordCount: balances.length,
    autoClosedCount: autoClosed,
    manualConfirmCount: actions.filter((a) => a.action !== 'ignore_once').length,
    negativeInventoryCount: exceptions.filter((e) => e.code === 'NEGATIVE_INVENTORY').length,
    shortageCount: exceptions.filter((e) => e.code === 'MATERIAL_SHORTAGE').length,
    excessiveScrapCount: exceptions.filter((e) => e.code === 'EXCESSIVE_SCRAP').length,
  };

  return {
    ...result,
    balances,
    calcDetails: details,
    replenishTickets,
    scrapTickets,
    varianceTickets,
    exceptions,
    summary,
    appliedActions: actions,
  };
}

function roundSum(values: number[]): number {
  return Math.round(values.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0) * 1000) / 1000;
}

export function enrichResultMetrics(
  result: MaterialDailyCloseWorkflowResult,
  rules: EnterpriseRules,
): MaterialDailyCloseWorkflowResult {
  const negativeInventoryCount = result.exceptions.filter((e) => e.code === 'NEGATIVE_INVENTORY').length;
  const shortageCount = result.exceptions.filter((e) => e.code === 'MATERIAL_SHORTAGE').length;
  const excessiveScrapCount = result.exceptions.filter((e) => e.code === 'EXCESSIVE_SCRAP').length;
  const lowConfidenceManual = result.exceptions.filter(
    (e) => e.code === 'MISSING_REQUIRED_FIELD' || e.code === 'UNIT_CONFLICT',
  ).length;

  return {
    ...result,
    summary: {
      ...result.summary,
      processedRecordCount: result.summary.balanceRows,
      autoClosedCount: Math.max(0, result.summary.balanceRows - result.exceptions.length),
      manualConfirmCount: lowConfidenceManual,
      negativeInventoryCount,
      shortageCount,
      excessiveScrapCount,
      safetyStockHint: result.balances.reduce(
        (n, line) => n + (resolveSafetyStock(rules, line.materialCode, line.materialName) > 0 ? 1 : 0),
        0,
      ),
    },
  };
}

export type { MaterialCalcDetail };
