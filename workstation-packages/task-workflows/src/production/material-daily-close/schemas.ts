import { z } from 'zod';
import type { MaterialInputType } from './types.js';

export const MaterialInputTypeSchema = z.enum([
  'inventory',
  'materialIssue',
  'materialReturn',
  'scrap',
  'productionPlan',
]);

const optionalText = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  });

const quantityField = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '数量无效' });
        return z.NEVER;
      }
      return value;
    }
    const text = String(value).trim().replace(/,/g, '');
    if (!text) return 0;
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `无法解析数量: ${value}` });
      return z.NEVER;
    }
    return parsed;
  });

/** 实盘可为空（无盘点时不强制） */
const nullableQuantityField = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '实盘数量无效' });
        return z.NEVER;
      }
      return value;
    }
    const text = String(value).trim().replace(/,/g, '');
    if (!text) return null;
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `无法解析实盘数量: ${value}` });
      return z.NEVER;
    }
    return parsed;
  });

const dateField = z
  .union([z.string(), z.date(), z.number(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === '') return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      // Excel serial date roughly
      const excelEpoch = Date.UTC(1899, 11, 30);
      const ms = excelEpoch + value * 86_400_000;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
    }
    const text = String(value).trim();
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime()) && /^\d{4}/.test(text)) {
      return parsed.toISOString().slice(0, 10);
    }
    return text;
  });

/** 统一标准字段（Zod） */
export const StandardMaterialRowSchema = z.object({
  materialCode: optionalText,
  materialName: optionalText,
  specification: optionalText,
  warehouse: optionalText,
  batchNo: optionalText,
  unit: optionalText,
  openingQuantity: quantityField,
  inboundQuantity: quantityField,
  issuedQuantity: quantityField,
  returnedQuantity: quantityField,
  scrapQuantity: quantityField,
  countedQuantity: nullableQuantityField,
  plannedQuantity: quantityField,
  actualOutputQuantity: quantityField,
  transactionDate: dateField,
  remark: optionalText,
  sourceType: MaterialInputTypeSchema,
  sourceFile: z.string().min(1),
  sourceSheet: z.string().min(1),
  sourceRowIndex: z.number().int().nonnegative(),
});

export type StandardMaterialRowParsed = z.infer<typeof StandardMaterialRowSchema>;

export const MaterialDailyBalanceLineSchema = z.object({
  materialCode: z.string(),
  materialName: z.string().min(1),
  specification: z.string(),
  warehouse: z.string(),
  batchNo: z.string(),
  unit: z.string(),
  openingQuantity: z.number(),
  inboundQuantity: z.number(),
  issuedQuantity: z.number(),
  returnedQuantity: z.number(),
  scrapQuantity: z.number(),
  /** @deprecated 使用 closingQuantity；保留兼容旧调用 */
  theoreticalQuantity: z.number(),
  closingQuantity: z.number().optional(),
  countedQuantity: z.number().nullable(),
  varianceQuantity: z.number().nullable(),
  replenishQuantity: z.number().nonnegative(),
  plannedQuantity: z.number(),
  actualOutputQuantity: z.number(),
  transactionDate: z.string(),
  remark: z.string(),
});

export const RemarkActionSchema = z.enum([
  'APPROVED_SCRAP',
  'TEMPORARY_BORROW',
  'RETURN_NEXT_BATCH',
  'WAITING_WAREHOUSE_CONFIRMATION',
  'IGNORE_FOR_TODAY',
  'MANUAL_REVIEW',
]);

export const AiRemarkResultSchema = z.object({
  recordCode: z.string(),
  action: RemarkActionSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export const AiFieldSuggestionSchema = z.object({
  standardField: z.string(),
  sourceColumn: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
});

export const AiExceptionExplanationSchema = z.object({
  code: z.string(),
  explanation: z.string(),
  suggestedAction: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const ClarificationAnswerSchema = z.object({
  questionId: z.string().min(1),
  value: z.string().min(1),
});

export function parseStandardRow(
  input: unknown,
): { ok: true; data: StandardMaterialRowParsed } | { ok: false; error: string } {
  const parsed = StandardMaterialRowSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  return { ok: true, data: parsed.data };
}

export function assertInputType(value: string): MaterialInputType {
  return MaterialInputTypeSchema.parse(value);
}
