import { z } from 'zod';
import {
  AiExceptionExplanationSchema,
  AiFieldSuggestionSchema,
  AiRemarkResultSchema,
  RemarkActionSchema,
} from './schemas.js';
import type {
  AiHintPayload,
  MaterialDailyCloseWorkflowResult,
  MaterialException,
  MaterialTicketRow,
} from './types.js';

export type AiAllowedOperation = 'FIELD_RECOGNITION' | 'REMARK_CLASSIFICATION' | 'EXCEPTION_EXPLANATION';

export const REMARK_ACTIONS = RemarkActionSchema.options;

/**
 * AI 只处理模糊例外。禁止发送完整原始文件、不相关行、敏感资料、全部正常记录。
 * 实际 LLM 调用必须走统一后端 analyze（额度冻结 / 结算 / 失败退款）。
 */
export function buildAiOperationPayload(
  operation: AiAllowedOperation,
  body: Record<string, unknown>,
): {
  operation: AiAllowedOperation;
  structuredData: Record<string, unknown>;
  userInstruction: string;
} {
  const note =
    '禁止改写或重新计算任何库存数量。禁止臆造未提供的字段。仅返回 JSON。';

  if (operation === 'FIELD_RECOGNITION') {
    return {
      operation,
      structuredData: {
        operation,
        headers: body.headers ?? [],
        unresolvedHeaders: body.unresolvedHeaders ?? [],
        sampleRows: body.sampleRows ?? [],
        knownMatches: body.knownMatches ?? [],
        note,
      },
      userInstruction:
        'FIELD_RECOGNITION：根据表头与少量样例，为未匹配列建议标准字段（materialCode/materialName/issuedQuantity 等）。返回 { suggestions:[{standardField,sourceColumn,confidence,reason}] }。',
    };
  }

  if (operation === 'REMARK_CLASSIFICATION') {
    return {
      operation,
      structuredData: {
        operation,
        remarks: body.remarks ?? [],
        allowedActions: REMARK_ACTIONS,
        note,
      },
      userInstruction: `REMARK_CLASSIFICATION：将备注分类为 ${REMARK_ACTIONS.join(' / ')}。返回 { results:[{recordCode,action,confidence,reason}] }。`,
    };
  }

  return {
    operation,
    structuredData: {
      operation,
      exceptions: body.exceptions ?? [],
      note,
    },
    userInstruction:
      'EXCEPTION_EXPLANATION：用中文解释异常优先级与核对建议，不要改数量。返回 { explanations:[{code,explanation,suggestedAction,confidence}] }。',
  };
}

export function parseAiFieldSuggestions(result: unknown): Array<{
  standardField: string;
  sourceColumn: string;
  confidence: number;
  reason?: string;
}> {
  const root = (result ?? {}) as Record<string, unknown>;
  const list = Array.isArray(root.suggestions) ? root.suggestions : Array.isArray(result) ? result : [];
  return list
    .map((item) => AiFieldSuggestionSchema.safeParse(item))
    .filter((item): item is { success: true; data: z.infer<typeof AiFieldSuggestionSchema> } => item.success)
    .map((item) => item.data);
}

export function parseAiRemarkResults(
  result: unknown,
  confidenceThreshold: number,
): Array<{ recordCode: string; action: z.infer<typeof RemarkActionSchema>; confidence: number; reason: string }> {
  const root = (result ?? {}) as Record<string, unknown>;
  const list = Array.isArray(root.results) ? root.results : [];
  return list
    .map((item) => AiRemarkResultSchema.safeParse(item))
    .filter((item): item is { success: true; data: z.infer<typeof AiRemarkResultSchema> } => item.success)
    .map((item) => {
      const data = item.data;
      if (data.confidence < confidenceThreshold) {
        return { ...data, action: 'MANUAL_REVIEW' as const, reason: `${data.reason}（置信度低于阈值，强制人工复核）` };
      }
      return data;
    });
}

export function parseAiExceptionExplanations(result: unknown) {
  const root = (result ?? {}) as Record<string, unknown>;
  const list = Array.isArray(root.explanations) ? root.explanations : [];
  return list
    .map((item) => AiExceptionExplanationSchema.safeParse(item))
    .filter((item) => item.success)
    .map((item) => item.data);
}

/** 备注分类仅发送异常/待判备注，绝不发送全量正常行 */
export function pickRemarkCandidatesForAi(
  rows: Array<{ recordCode: string; remark: string; materialCode?: string; materialName?: string }>,
  limit = 40,
): Array<{ recordCode: string; remark: string; materialCode?: string; materialName?: string }> {
  return rows
    .filter((row) => row.remark && row.remark.trim())
    .slice(0, limit)
    .map((row) => ({
      recordCode: row.recordCode,
      remark: row.remark.slice(0, 200),
      materialCode: row.materialCode,
      materialName: row.materialName,
    }));
}

export function buildAiHintPayload(input: {
  generatedAt: string;
  sourceFiles: string[];
  summary: MaterialDailyCloseWorkflowResult['summary'];
  replenishTickets: MaterialTicketRow[];
  scrapTickets: MaterialTicketRow[];
  varianceTickets: MaterialTicketRow[];
  exceptions: MaterialException[];
}): AiHintPayload {
  return {
    meta: {
      workflowCode: 'PRODUCTION_MATERIAL_DAILY_CLOSE',
      generatedAt: input.generatedAt,
      sourceFiles: input.sourceFiles,
    },
    metrics: {
      balanceRows: input.summary.balanceRows,
      replenishCount: input.summary.replenishCount,
      scrapTicketCount: input.summary.scrapTicketCount,
      varianceCount: input.summary.varianceCount,
      totalReplenishQty: input.summary.totalReplenishQty,
      totalScrapQty: input.summary.totalScrapQty,
      totalShortageQty: input.summary.totalShortageQty,
      totalOverageQty: input.summary.totalOverageQty,
    },
    sampleReplenish: input.replenishTickets.slice(0, 20),
    sampleScrap: input.scrapTickets.slice(0, 20),
    sampleVariance: input.varianceTickets.slice(0, 20),
    exceptions: input.exceptions.slice(0, 40).map((item) => ({
      code: item.code,
      severity: item.severity,
      message: item.message,
    })),
    note: '数量均由本地日清规则计算。请仅生成今日处理优先级与核对建议，禁止改写任何数量。禁止发送/索要完整原始表。',
  };
}

export const AI_HINT_USER_INSTRUCTION =
  'EXCEPTION_EXPLANATION：根据已算出的补料/报废/盘点差异与异常码，给出今日车间处理顺序与核对要点，禁止重新计算库存数量。';
