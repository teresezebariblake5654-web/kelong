import {
  CRITICAL_FIELDS_BY_TYPE,
  FIELD_DICTIONARY,
  TYPE_HINTS,
  normalizeToken,
  type StandardFieldKey,
} from './fieldDictionary.js';
import { recognizeFields } from './fieldRecognizer.js';
import type { LocalHistoryStore } from './localHistory.js';
import {
  MATERIAL_INPUT_TYPE_LABELS,
  MATERIAL_INPUT_TYPES,
  type FieldMatch,
  type MaterialInputType,
  type RawSheetInput,
  type RawWorkbookInput,
  type SheetDetectionResult,
} from './types.js';

const CONFIDENCE_AUTO = 0.72;
const CONFIDENCE_ASK = 0.45;

export type DetectSheetOptions = {
  scopeKey?: string;
  historyStore?: LocalHistoryStore;
  aiSuggestions?: Array<{ standardField: StandardFieldKey; sourceColumn: string; confidence: number }>;
  userConfirmed?: Partial<Record<StandardFieldKey, string>>;
};

function matchFields(
  headers: string[],
  rows: Array<Record<string, unknown>>,
  options?: DetectSheetOptions,
): { matches: FieldMatch[]; aiFieldPayload: Record<string, unknown> } {
  const recognized = recognizeFields({
    headers,
    rows,
    scopeKey: options?.scopeKey,
    historyStore: options?.historyStore,
    aiSuggestions: options?.aiSuggestions,
    userConfirmed: options?.userConfirmed,
  });
  return { matches: recognized.matches, aiFieldPayload: recognized.aiFieldPayload };
}

function hasField(matches: FieldMatch[], key: StandardFieldKey): boolean {
  return matches.some((item) => item.standardField === key);
}

function keywordHit(text: string, keywords: string[]): number {
  const n = normalizeToken(text);
  let hits = 0;
  for (const keyword of keywords) {
    if (n.includes(normalizeToken(keyword))) hits += 1;
  }
  return hits;
}

function scoreType(
  inputType: MaterialInputType,
  fileName: string,
  sheetName: string,
  matches: FieldMatch[],
  sampleRows: Array<Record<string, unknown>>,
): { score: number; reasons: string[] } {
  const hints = TYPE_HINTS[inputType];
  const critical = CRITICAL_FIELDS_BY_TYPE[inputType];
  const reasons: string[] = [];
  let score = 0;

  const fileHits = keywordHit(fileName, hints.fileNameKeywords);
  const sheetHits = keywordHit(sheetName, hints.sheetKeywords);
  if (fileHits) {
    score += 0.22 * Math.min(fileHits, 2);
    reasons.push(`文件名像「${MATERIAL_INPUT_TYPE_LABELS[inputType]}」`);
  }
  if (sheetHits) {
    score += 0.18 * Math.min(sheetHits, 2);
    reasons.push(`工作表名像「${MATERIAL_INPUT_TYPE_LABELS[inputType]}」`);
  }

  let criticalHits = 0;
  for (const key of critical) {
    if (hasField(matches, key)) {
      criticalHits += 1;
      score += 0.28;
    }
  }
  if (criticalHits === critical.length) {
    reasons.push(`表头命中关键字段：${critical.join('、')}`);
  }

  for (const boost of hints.headerBoostFields) {
    if (hasField(matches, boost)) score += 0.08;
  }

  // Sample: quantity columns tend to have numbers
  if (sampleRows.length && criticalHits > 0) {
    const qtyField = matches.find((m) => critical.includes(m.standardField as StandardFieldKey));
    if (qtyField) {
      const numeric = sampleRows.slice(0, 8).filter((row) => {
        const value = row[qtyField.sourceColumn];
        if (typeof value === 'number') return Number.isFinite(value);
        const text = String(value ?? '').trim().replace(/,/g, '');
        return text !== '' && Number.isFinite(Number(text));
      }).length;
      if (numeric >= 2) {
        score += 0.1;
        reasons.push('样例数据数量列可解析');
      }
    }
  }

  // Prefer inventory when both opening + counted present
  if (inputType === 'inventory' && hasField(matches, 'countedQuantity') && hasField(matches, 'openingQuantity')) {
    score += 0.12;
    reasons.push('同时含期初与实盘，倾向库存日清表');
  }

  return { score: Math.min(score, 0.99), reasons };
}

export function detectSheet(input: RawSheetInput, options?: DetectSheetOptions): SheetDetectionResult {
  const { matches: fieldMatches, aiFieldPayload } = matchFields(input.headers, input.rows, options);
  const sampleRows = input.rows.slice(0, 12);

  if (input.forcedType) {
    const critical = CRITICAL_FIELDS_BY_TYPE[input.forcedType];
    const unmatchedCritical = critical
      .filter((key) => !hasField(fieldMatches, key))
      .map((key) => FIELD_DICTIONARY.find((f) => f.key === key)?.label ?? key);

    const needsField =
      unmatchedCritical.length > 0
        ? {
            needsUserConfirm: true as const,
            confirmPrompt: {
              kind: 'criticalField' as const,
              message: `已指定为「${MATERIAL_INPUT_TYPE_LABELS[input.forcedType]}」，但仍缺关键列：${unmatchedCritical.join('、')}`,
              fieldKey: critical.find((key) => !hasField(fieldMatches, key)),
            },
          }
        : { needsUserConfirm: false as const };

    return {
      fileName: input.fileName,
      sheetName: input.sheetName,
      inputType: input.forcedType,
      confidence: unmatchedCritical.length ? 0.55 : 0.95,
      fieldMatches,
      unmatchedCritical,
      reasons: [`用户确认为「${MATERIAL_INPUT_TYPE_LABELS[input.forcedType]}」`],
      aiFieldPayload,
      ...needsField,
    };
  }

  const ranked = MATERIAL_INPUT_TYPES.map((inputType) => {
    const { score, reasons } = scoreType(
      inputType,
      input.fileName,
      input.sheetName,
      fieldMatches,
      sampleRows,
    );
    return { inputType, score, reasons };
  }).sort((a, b) => b.score - a.score);

  const best = ranked[0]!;
  const second = ranked[1];
  const gap = second ? best.score - second.score : best.score;
  let confidence = best.score;
  if (gap < 0.08) confidence = Math.min(confidence, 0.6);

  const critical = CRITICAL_FIELDS_BY_TYPE[best.inputType];
  const unmatchedCritical = critical
    .filter((key) => !hasField(fieldMatches, key))
    .map((key) => FIELD_DICTIONARY.find((f) => f.key === key)?.label ?? key);

  if (confidence >= CONFIDENCE_AUTO && unmatchedCritical.length === 0) {
    return {
      fileName: input.fileName,
      sheetName: input.sheetName,
      inputType: best.inputType,
      confidence,
      fieldMatches,
      unmatchedCritical: [],
      reasons: best.reasons,
      needsUserConfirm: false,
      aiFieldPayload,
    };
  }

  if (confidence >= CONFIDENCE_ASK && unmatchedCritical.length === 0) {
    return {
      fileName: input.fileName,
      sheetName: input.sheetName,
      inputType: best.inputType,
      confidence,
      fieldMatches,
      unmatchedCritical: [],
      reasons: best.reasons,
      needsUserConfirm: true,
      aiFieldPayload,
      confirmPrompt: {
        kind: 'inputType',
        message: `工作表「${input.sheetName}」更像「${MATERIAL_INPUT_TYPE_LABELS[best.inputType]}」，请确认文件类型`,
        options: MATERIAL_INPUT_TYPES.map((type) => ({
          value: type,
          label: MATERIAL_INPUT_TYPE_LABELS[type],
        })),
      },
    };
  }

  if (best.score < CONFIDENCE_ASK || unmatchedCritical.length > 0) {
    return {
      fileName: input.fileName,
      sheetName: input.sheetName,
      inputType: unmatchedCritical.length ? best.inputType : null,
      confidence,
      fieldMatches,
      unmatchedCritical,
      reasons: best.reasons.length ? best.reasons : ['表头特征不足，无法自动判定'],
      needsUserConfirm: true,
      aiFieldPayload,
      confirmPrompt: unmatchedCritical.length
        ? {
            kind: 'criticalField',
            message: `请确认「${input.sheetName}」中哪一列是「${unmatchedCritical[0]}」`,
            fieldKey: critical.find((key) => !hasField(fieldMatches, key)),
            options: input.headers.map((header) => ({ value: header, label: header })),
          }
        : {
            kind: 'inputType',
            message: `无法自动判断「${input.sheetName}」类型，请选择`,
            options: MATERIAL_INPUT_TYPES.map((type) => ({
              value: type,
              label: MATERIAL_INPUT_TYPE_LABELS[type],
            })),
          },
    };
  }

  return {
    fileName: input.fileName,
    sheetName: input.sheetName,
    inputType: best.inputType,
    confidence,
    fieldMatches,
    unmatchedCritical,
    reasons: best.reasons,
    needsUserConfirm: false,
    aiFieldPayload,
  };
}

/**
 * 扫描工作簿全部 Sheet，自动挑选最可能的类型页。
 * 同一类型多个 sheet 时取置信度最高者；不同类型可并存。
 */
export function detectWorkbook(
  workbook: RawWorkbookInput,
  options?: DetectSheetOptions,
): SheetDetectionResult[] {
  const sheetResults = workbook.sheets.map((sheet) =>
    detectSheet(
      {
        fileName: workbook.fileName,
        sheetName: sheet.sheetName,
        headers: sheet.headers,
        rows: sheet.rows,
      },
      options,
    ),
  );

  const byType = new Map<MaterialInputType, SheetDetectionResult>();
  const unresolved: SheetDetectionResult[] = [];

  for (const result of sheetResults) {
    if (!result.inputType || result.needsUserConfirm) {
      // keep only sheets that look like material tables (have materialName match) for clarification
      const hasMaterial = result.fieldMatches.some((m) => m.standardField === 'materialName');
      if (hasMaterial || result.confidence >= CONFIDENCE_ASK) unresolved.push(result);
      continue;
    }
    const existing = byType.get(result.inputType);
    if (!existing || result.confidence > existing.confidence) {
      byType.set(result.inputType, result);
    }
  }

  return [...byType.values(), ...unresolved];
}

export function detectMany(
  workbooks: RawWorkbookInput[],
  options?: DetectSheetOptions,
): SheetDetectionResult[] {
  const all = workbooks.flatMap((workbook) => detectWorkbook(workbook, options));
  // Deduplicate by type keeping highest confidence auto sheets; keep all clarifications
  const auto = new Map<MaterialInputType, SheetDetectionResult>();
  const asks: SheetDetectionResult[] = [];
  for (const item of all) {
    if (item.needsUserConfirm || !item.inputType) {
      asks.push(item);
      continue;
    }
    const prev = auto.get(item.inputType);
    if (!prev || item.confidence > prev.confidence) auto.set(item.inputType, item);
  }
  return [...auto.values(), ...asks];
}
