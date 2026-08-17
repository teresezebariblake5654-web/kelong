import {
  FIELD_DICTIONARY,
  normalizeToken,
  type StandardFieldKey,
} from './fieldDictionary.js';
import {
  findHistoricalMapping,
  type LocalHistoryStore,
} from './localHistory.js';
import { parseQuantity } from './quantityParse.js';
import type { FieldMatch } from './types.js';

export type RecognitionMethod =
  | 'history'
  | 'exactAlias'
  | 'normalizedAlias'
  | 'sampleType'
  | 'aiSemantic'
  | 'userConfirm';

export type RankedFieldCandidate = {
  standardField: StandardFieldKey;
  sourceColumn: string;
  confidence: number;
  method: RecognitionMethod;
};

export type FieldRecognitionResult = {
  matches: FieldMatch[];
  ranked: RankedFieldCandidate[];
  unresolvedHeaders: string[];
  /** 可供 DeepSeek FIELD_RECOGNITION 的压缩上下文（非全表） */
  aiFieldPayload: {
    operation: 'FIELD_RECOGNITION';
    headers: string[];
    sampleRows: Array<Record<string, unknown>>;
    unresolvedHeaders: string[];
    knownMatches: Array<{ standardField: string; sourceColumn: string; method: string }>;
  };
};

function columnSampleScore(
  header: string,
  rows: Array<Record<string, unknown>>,
  expected: 'string' | 'number' | 'date',
): number {
  const values = rows.slice(0, 12).map((row) => row[header]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
  if (!values.length) return 0;
  let hits = 0;
  for (const value of values) {
    if (expected === 'number') {
      if (Number.isFinite(parseQuantity(value, Number.NaN))) hits += 1;
    } else if (expected === 'date') {
      const text = String(value);
      if (value instanceof Date || /^\d{4}[-/]\d{1,2}/.test(text)) hits += 1;
    } else {
      if (typeof value === 'string' || typeof value === 'number') hits += 1;
    }
  }
  return hits / values.length;
}

/**
 * 字段识别顺序：
 * 1 客户本地历史映射
 * 2 精确别名
 * 3 归一化别名
 * 4 数据类型与样例判断
 * 5（可选）DeepSeek 语义 — 由调用方注入 aiSuggestions
 * 6 用户确认关键字段 — 由 answers 注入
 */
export function recognizeFields(input: {
  headers: string[];
  rows: Array<Record<string, unknown>>;
  scopeKey?: string;
  historyStore?: LocalHistoryStore;
  /** DeepSeek FIELD_RECOGNITION 返回的建议 */
  aiSuggestions?: Array<{ standardField: StandardFieldKey; sourceColumn: string; confidence: number }>;
  /** 用户确认：standardField -> sourceColumn */
  userConfirmed?: Partial<Record<StandardFieldKey, string>>;
}): FieldRecognitionResult {
  const usedHeaders = new Set<string>();
  const ranked: RankedFieldCandidate[] = [];
  const assigned = new Map<StandardFieldKey, RankedFieldCandidate>();

  const take = (candidate: RankedFieldCandidate) => {
    if (usedHeaders.has(candidate.sourceColumn)) return;
    if (assigned.has(candidate.standardField)) return;
    usedHeaders.add(candidate.sourceColumn);
    assigned.set(candidate.standardField, candidate);
    ranked.push(candidate);
  };

  // 6 / 用户确认优先落库后当历史用，这里直接最高优先级
  if (input.userConfirmed) {
    for (const [key, col] of Object.entries(input.userConfirmed) as Array<[StandardFieldKey, string]>) {
      if (col && input.headers.includes(col)) {
        take({
          standardField: key,
          sourceColumn: col,
          confidence: 1,
          method: 'userConfirm',
        });
      }
    }
  }

  // 1 历史映射
  if (input.historyStore && input.scopeKey) {
    const hist = findHistoricalMapping(input.historyStore, input.scopeKey, input.headers);
    if (hist) {
      for (const [key, col] of Object.entries(hist.mappings) as Array<[StandardFieldKey, string]>) {
        if (col && input.headers.includes(col)) {
          take({
            standardField: key,
            sourceColumn: col,
            confidence: 0.98,
            method: 'history',
          });
        }
      }
    }
  }

  // 2 精确别名
  for (const field of FIELD_DICTIONARY) {
    for (const header of input.headers) {
      if (usedHeaders.has(header)) continue;
      const exact = field.aliases.some((alias) => alias === header) || field.label === header;
      if (exact) {
        take({
          standardField: field.key,
          sourceColumn: header,
          confidence: 0.95,
          method: 'exactAlias',
        });
        break;
      }
    }
  }

  // 3 归一化别名
  for (const field of FIELD_DICTIONARY) {
    if (assigned.has(field.key)) continue;
    const aliasSet = new Set([field.key, field.label, ...field.aliases].map(normalizeToken));
    let best: { header: string; score: number } | null = null;
    for (const header of input.headers) {
      if (usedHeaders.has(header)) continue;
      const nh = normalizeToken(header);
      if (!nh) continue;
      let score = 0;
      if (aliasSet.has(nh)) score = 1;
      else {
        for (const alias of aliasSet) {
          if (!alias) continue;
          if (nh.includes(alias) || alias.includes(nh)) {
            score = Math.max(score, Math.min(nh.length, alias.length) / Math.max(nh.length, alias.length));
          }
        }
      }
      if (score >= 0.72 && (!best || score > best.score)) best = { header, score };
    }
    if (best) {
      take({
        standardField: field.key,
        sourceColumn: best.header,
        confidence: Number((0.7 + best.score * 0.2).toFixed(3)),
        method: 'normalizedAlias',
      });
    }
  }

  // 4 数据类型与样例判断（仅补未匹配的数量类字段）
  for (const field of FIELD_DICTIONARY) {
    if (assigned.has(field.key) || field.dataType !== 'number') continue;
    let best: { header: string; score: number } | null = null;
    for (const header of input.headers) {
      if (usedHeaders.has(header)) continue;
      const score = columnSampleScore(header, input.rows, 'number');
      const nameHint = normalizeToken(header);
      const fieldHint = normalizeToken(field.label);
      const boost = nameHint.includes(fieldHint.slice(0, 2)) ? 0.15 : 0;
      const total = score + boost;
      if (total >= 0.75 && (!best || total > best.score)) best = { header, score: total };
    }
    if (best) {
      take({
        standardField: field.key,
        sourceColumn: best.header,
        confidence: Number(Math.min(0.8, best.score).toFixed(3)),
        method: 'sampleType',
      });
    }
  }

  // 5 AI 语义建议（不得覆盖更高优先级）
  for (const suggestion of input.aiSuggestions ?? []) {
    if (!input.headers.includes(suggestion.sourceColumn)) continue;
    take({
      standardField: suggestion.standardField,
      sourceColumn: suggestion.sourceColumn,
      confidence: Math.min(0.85, suggestion.confidence),
      method: 'aiSemantic',
    });
  }

  const matches: FieldMatch[] = [...assigned.values()].map((item) => ({
    standardField: item.standardField,
    sourceColumn: item.sourceColumn,
    confidence: item.confidence,
    method: item.method,
  }));

  const unresolvedHeaders = input.headers.filter((header) => !usedHeaders.has(header));
  const sampleRows = input.rows.slice(0, 5).map((row) => {
    const slim: Record<string, unknown> = {};
    for (const header of unresolvedHeaders.slice(0, 12)) {
      slim[header] = row[header];
    }
    // 附带已匹配列名（不含全量业务值）帮助语义，但不发完整文件
    for (const match of matches.slice(0, 8)) {
      slim[`__matched__${match.standardField}`] = match.sourceColumn;
    }
    return slim;
  });

  return {
    matches,
    ranked,
    unresolvedHeaders,
    aiFieldPayload: {
      operation: 'FIELD_RECOGNITION',
      headers: input.headers,
      sampleRows,
      unresolvedHeaders,
      knownMatches: matches.map((m) => ({
        standardField: m.standardField,
        sourceColumn: m.sourceColumn,
        method: (m as FieldMatch & { method?: string }).method ?? 'unknown',
      })),
    },
  };
}
