import { buildAiHintPayload } from './aiResolver.js';
import { evaluateBusinessRules } from './businessRules.js';
import { runMaterialCalcEngine } from './calcEngine.js';
import {
  DEFAULT_ENTERPRISE_RULES,
  mergeEnterpriseRules,
  type EnterpriseRules,
} from './enterpriseRules.js';
import { detectMany, detectSheet } from './inputDetector.js';
import {
  loadOrDefaultRules,
  saveConfirmedMappings,
  type LocalHistoryStore,
} from './localHistory.js';
import { normalizeSheet } from './normalizer.js';
import { enrichResultMetrics } from './exceptionActions.js';
import {
  buildMaterialDailyCloseWorkbook,
  buildReplenishTickets,
  buildScrapTickets,
  buildVarianceTickets,
} from './outputBuilder.js';
import { assertInputType } from './schemas.js';
import type { StandardFieldKey } from './fieldDictionary.js';
import type {
  ClarificationQuestion,
  MaterialDailyCloseWorkflowResult,
  MaterialInputType,
  RawSheetInput,
  RawWorkbookInput,
  SheetDetectionResult,
  UserClarificationAnswer,
} from './types.js';

export const WORKFLOW_CODE = 'PRODUCTION_MATERIAL_DAILY_CLOSE' as const;

export * from './types.js';
export * from './schemas.js';
export * from './fieldDictionary.js';
export * from './enterpriseRules.js';
export * from './localHistory.js';
export * from './fieldRecognizer.js';
export * from './quantityParse.js';
export {
  detectSheet,
  detectWorkbook,
  detectMany,
} from './inputDetector.js';
export { normalizeSheet } from './normalizer.js';
export { runDailyCloseRules, runMaterialCalcEngine, buildMergeKey } from './ruleEngine.js';
export { detectExceptions, evaluateBusinessRules } from './exceptionDetector.js';
export {
  buildAiHintPayload,
  AI_HINT_USER_INSTRUCTION,
  buildAiOperationPayload,
  parseAiFieldSuggestions,
  parseAiRemarkResults,
  parseAiExceptionExplanations,
  pickRemarkCandidatesForAi,
  type AiAllowedOperation,
} from './aiResolver.js';
export {
  buildMaterialDailyCloseWorkbook,
  buildReplenishTickets,
  buildScrapTickets,
  buildVarianceTickets,
  exportWorkbook,
  materialDailyCloseFileName,
} from './outputBuilder.js';
export {
  buildFiveDeliverables,
  buildClosingBalanceRows,
  buildReplenishDeliverableRows,
  buildScrapDeliverableRows,
  buildVarianceDeliverableRows,
  buildManualConfirmRows,
  type DeliverableFile,
  type DeliverableKind,
} from './deliverables.js';
export {
  applyExceptionActionsAndRecompute,
  enrichResultMetrics,
  exceptionBusinessKey,
  optionsForException,
  toBusinessFacingException,
  type AppliedExceptionAction,
  type ExceptionUserAction,
  type ExceptionActionOption,
} from './exceptionActions.js';
export {
  MATERIAL_CLOSE_SCHEMA_SQL,
  createMemorySqlDatabase,
  createMaterialCloseRepository,
  createHistoryStoreFromRepository,
  type MaterialCloseRepository,
  type SqlDatabase,
} from './localDb/index.js';
export { getBootstrapRuleQuestions } from './enterpriseRules.js';
export type { BusinessRuleCode } from './businessRules.js';
export {
  sampleStandardChinese,
  sampleAliasHeaders,
  sampleMultiSheet,
  sampleMultiWarehouseBatch,
  sampleExceptionScenarios,
  samplePerformance10k,
} from './samples/fixtures.js';

function clarificationId(detection: SheetDetectionResult): string {
  return `${detection.fileName}::${detection.sheetName}::${detection.confirmPrompt?.kind ?? 'ask'}`;
}

function toClarifications(detections: SheetDetectionResult[]): ClarificationQuestion[] {
  return detections
    .filter((item) => item.needsUserConfirm && item.confirmPrompt)
    .map((item) => ({
      id: clarificationId(item),
      fileName: item.fileName,
      sheetName: item.sheetName,
      kind: item.confirmPrompt!.kind,
      message: item.confirmPrompt!.message,
      options: item.confirmPrompt!.options,
      fieldKey: item.confirmPrompt!.fieldKey,
      defaultValue: item.confirmPrompt!.defaultValue,
    }));
}

function findSheet(
  workbooks: RawWorkbookInput[],
  fileName: string,
  sheetName: string,
): RawSheetInput | null {
  const workbook = workbooks.find((item) => item.fileName === fileName);
  const sheet = workbook?.sheets.find((item) => item.sheetName === sheetName);
  if (!workbook || !sheet) return null;
  return {
    fileName: workbook.fileName,
    sheetName: sheet.sheetName,
    headers: sheet.headers,
    rows: sheet.rows,
  };
}

function applyAnswers(
  workbooks: RawWorkbookInput[],
  detections: SheetDetectionResult[],
  answers: UserClarificationAnswer[],
  options?: { scopeKey?: string; historyStore?: LocalHistoryStore },
): SheetDetectionResult[] {
  if (!answers.length) return detections;
  const answerMap = new Map(answers.map((item) => [item.questionId, item.value]));

  return detections.map((detection) => {
    const qid = clarificationId(detection);
    const answer = answerMap.get(qid);
    if (!answer || !detection.confirmPrompt) return detection;

    const sheet = findSheet(workbooks, detection.fileName, detection.sheetName);
    if (!sheet) return detection;

    if (detection.confirmPrompt.kind === 'inputType') {
      try {
        const forcedType = assertInputType(answer);
        return detectSheet({ ...sheet, forcedType }, options);
      } catch {
        return detection;
      }
    }

    if (detection.confirmPrompt.kind === 'criticalField' && detection.confirmPrompt.fieldKey) {
      const fieldKey = detection.confirmPrompt.fieldKey as StandardFieldKey;
      const forcedType = detection.inputType ?? 'inventory';
      const userConfirmed = { [fieldKey]: answer } as Partial<Record<StandardFieldKey, string>>;
      const redetected = detectSheet(
        { ...sheet, forcedType },
        { ...options, userConfirmed },
      );

      // 用户确认后写入本地历史映射，后续自动复用
      if (options?.historyStore && options.scopeKey) {
        const mappings = Object.fromEntries(
          redetected.fieldMatches.map((m) => [m.standardField, m.sourceColumn]),
        ) as Partial<Record<StandardFieldKey, string>>;
        mappings[fieldKey] = answer;
        saveConfirmedMappings(options.historyStore, options.scopeKey, sheet.headers, mappings);
      }

      return {
        ...redetected,
        needsUserConfirm: redetected.unmatchedCritical.length > 0,
        confirmPrompt:
          redetected.unmatchedCritical.length > 0
            ? {
                kind: 'criticalField' as const,
                message: `仍缺关键列：${redetected.unmatchedCritical[0]}`,
                options: sheet.headers.map((header) => ({ value: header, label: header })),
              }
            : undefined,
        confidence: 0.95,
        reasons: [...redetected.reasons, `用户确认并已保存映射 ${fieldKey}←${answer}`],
      };
    }

    return detection;
  });
}

export type RunMaterialDailyCloseInput = {
  workbooks: RawWorkbookInput[];
  answers?: UserClarificationAnswer[];
  scopeKey?: string;
  historyStore?: LocalHistoryStore;
  enterpriseRules?: EnterpriseRules;
  /** DeepSeek FIELD_RECOGNITION 建议（经后端 analyze） */
  aiFieldSuggestions?: Array<{ standardField: StandardFieldKey; sourceColumn: string; confidence: number }>;
};

/**
 * 物料日清办结工作流入口：
 * 历史映射/别名认列 → 规范化 → 确定性计算 → 业务规则 → 单据
 * AI 不参与数量计算；原始全表不上传。
 */
export function runMaterialDailyCloseWorkflow(
  input: RunMaterialDailyCloseInput,
): MaterialDailyCloseWorkflowResult {
  const generatedAt = new Date().toISOString();
  const scopeKey = input.scopeKey ?? 'default';
  const detectOpts = {
    scopeKey,
    historyStore: input.historyStore,
    aiSuggestions: input.aiFieldSuggestions,
  };

  let detections = detectMany(input.workbooks, detectOpts);
  detections = applyAnswers(input.workbooks, detections, input.answers ?? [], detectOpts);

  const clarifications = toClarifications(detections);
  if (clarifications.length > 0) {
    return emptyBlockedResult(generatedAt, detections, clarifications, input.workbooks);
  }

  // 企业规则：首次自动落默认值并保存；不阻断办结（可在设置中改）
  let rules =
    input.enterpriseRules ??
    (input.historyStore ? loadOrDefaultRules(input.historyStore, scopeKey) : { ...DEFAULT_ENTERPRISE_RULES });
  if (input.historyStore && !input.historyStore.getEnterpriseRules(scopeKey)) {
    rules = mergeEnterpriseRules(DEFAULT_ENTERPRISE_RULES, input.enterpriseRules ?? {});
    input.historyStore.saveEnterpriseRules(scopeKey, rules);
  }

  // 允许通过 answers 覆盖少量企业规则
  const ruleAnswers = (input.answers ?? []).filter((a) => a.questionId.startsWith('enterpriseRule::'));
  if (ruleAnswers.length) {
    const patch: Partial<EnterpriseRules> = {};
    for (const ans of ruleAnswers) {
      const key = ans.questionId.replace('enterpriseRule::', '') as keyof EnterpriseRules;
      const num = Number(ans.value);
      if (Number.isFinite(num)) (patch as Record<string, number>)[key] = num;
    }
    rules = mergeEnterpriseRules(rules, patch);
    input.historyStore?.saveEnterpriseRules(scopeKey, rules);
  }

  const usable = detections.filter(
    (item): item is SheetDetectionResult & { inputType: MaterialInputType } =>
      Boolean(item.inputType) && !item.needsUserConfirm,
  );

  const chosen = new Map<MaterialInputType, SheetDetectionResult>();
  for (const item of usable) {
    const prev = chosen.get(item.inputType);
    if (!prev || item.confidence > prev.confidence) chosen.set(item.inputType, item);
  }

  // 自动保存高置信度映射
  if (input.historyStore) {
    for (const detection of chosen.values()) {
      const sheet = findSheet(input.workbooks, detection.fileName, detection.sheetName);
      if (!sheet) continue;
      const mappings = Object.fromEntries(
        detection.fieldMatches.map((m) => [m.standardField, m.sourceColumn]),
      ) as Partial<Record<StandardFieldKey, string>>;
      saveConfirmedMappings(input.historyStore, scopeKey, sheet.headers, mappings);
    }
  }

  const allRows = [];
  const normalizeErrors: string[] = [];
  for (const detection of chosen.values()) {
    const sheet = findSheet(input.workbooks, detection.fileName, detection.sheetName);
    if (!sheet) continue;
    const normalized = normalizeSheet(sheet, detection);
    allRows.push(...normalized.rows);
    normalizeErrors.push(...normalized.errors);
  }

  const calc = runMaterialCalcEngine(allRows, { quantityTolerance: rules.quantityTolerance });
  const balances = calc.balances;
  const calcDetails = calc.details;
  const replenishTickets = buildReplenishTickets(balances);
  const scrapTickets = buildScrapTickets(balances);
  const varianceTickets = buildVarianceTickets(balances);
  const exceptions = evaluateBusinessRules({
    balances,
    details: calcDetails,
    sourceRows: allRows,
    rules,
    normalizeErrors,
  });

  const summary = {
    inventoryRows: allRows.filter((r) => r.sourceType === 'inventory').length,
    issueRows: allRows.filter((r) => r.sourceType === 'materialIssue').length,
    returnRows: allRows.filter((r) => r.sourceType === 'materialReturn').length,
    scrapRows: allRows.filter((r) => r.sourceType === 'scrap').length,
    planRows: allRows.filter((r) => r.sourceType === 'productionPlan').length,
    balanceRows: balances.length,
    replenishCount: replenishTickets.length,
    scrapTicketCount: scrapTickets.length,
    varianceCount: varianceTickets.length,
    totalReplenishQty: roundSum(replenishTickets.map((r) => Number(r['建议补料数量'] ?? 0))),
    totalScrapQty: roundSum(scrapTickets.map((r) => Number(r['废料数量'] ?? 0))),
    totalShortageQty: roundSum(
      balances
        .filter((b) => (b.varianceQuantity ?? 0) < 0)
        .map((b) => Math.abs(b.varianceQuantity ?? 0)),
    ),
    totalOverageQty: roundSum(
      balances.filter((b) => (b.varianceQuantity ?? 0) > 0).map((b) => b.varianceQuantity ?? 0),
    ),
  };

  const sourceFiles = [...new Set(input.workbooks.map((item) => item.fileName))];

  return enrichResultMetrics(
    {
      workflowCode: WORKFLOW_CODE,
      generatedAt,
      detections: [...chosen.values()],
      clarifications: [],
      blocked: false,
      balances,
      calcDetails,
      replenishTickets,
      scrapTickets,
      varianceTickets,
      exceptions,
      summary,
      aiPayload: buildAiHintPayload({
        generatedAt,
        sourceFiles,
        summary,
        replenishTickets,
        scrapTickets,
        varianceTickets,
        exceptions,
      }),
    },
    rules,
  );
}

function roundSum(values: number[]): number {
  return Math.round(values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0) * 1000) / 1000;
}

function emptyBlockedResult(
  generatedAt: string,
  detections: SheetDetectionResult[],
  clarifications: ClarificationQuestion[],
  workbooks: RawWorkbookInput[],
  needsEnterpriseRules = false,
): MaterialDailyCloseWorkflowResult {
  return {
    workflowCode: WORKFLOW_CODE,
    generatedAt,
    detections,
    clarifications,
    blocked: true,
    needsEnterpriseRules,
    balances: [],
    calcDetails: [],
    replenishTickets: [],
    scrapTickets: [],
    varianceTickets: [],
    exceptions: clarifications.map((item) => ({
      code: item.kind === 'enterpriseRule' ? 'MISSING_REQUIRED_FIELD' : 'NEEDS_CLARIFICATION',
      severity: 'warning' as const,
      message: item.message,
    })),
    summary: {
      inventoryRows: 0,
      issueRows: 0,
      returnRows: 0,
      scrapRows: 0,
      planRows: 0,
      balanceRows: 0,
      replenishCount: 0,
      scrapTicketCount: 0,
      varianceCount: 0,
      totalReplenishQty: 0,
      totalScrapQty: 0,
      totalShortageQty: 0,
      totalOverageQty: 0,
    },
    aiPayload: buildAiHintPayload({
      generatedAt,
      sourceFiles: workbooks.map((item) => item.fileName),
      summary: {
        inventoryRows: 0,
        issueRows: 0,
        returnRows: 0,
        scrapRows: 0,
        planRows: 0,
        balanceRows: 0,
        replenishCount: 0,
        scrapTicketCount: 0,
        varianceCount: 0,
        totalReplenishQty: 0,
        totalScrapQty: 0,
        totalShortageQty: 0,
        totalOverageQty: 0,
      },
      replenishTickets: [],
      scrapTickets: [],
      varianceTickets: [],
      exceptions: [],
    }),
  };
}

export function workbookToWorkflowInput(workbook: {
  fileName: string;
  sheets: Array<{ name: string; headers: string[]; rows: Array<Record<string, unknown>> }>;
}): RawWorkbookInput {
  return {
    fileName: workbook.fileName,
    sheets: workbook.sheets.map((sheet) => ({
      sheetName: sheet.name,
      headers: sheet.headers,
      rows: sheet.rows,
    })),
  };
}

export function buildTicketPackageBytes(result: MaterialDailyCloseWorkflowResult): Uint8Array {
  if (result.blocked) {
    throw new Error('尚有文件类型/关键字段待确认，无法导出单据');
  }
  return buildMaterialDailyCloseWorkbook({
    generatedAt: result.generatedAt,
    sourceFiles: [...new Set(result.detections.map((item) => item.fileName))],
    summary: result.summary,
    balances: result.balances,
    calcDetails: result.calcDetails,
    replenishTickets: result.replenishTickets,
    scrapTickets: result.scrapTickets,
    varianceTickets: result.varianceTickets,
  });
}
