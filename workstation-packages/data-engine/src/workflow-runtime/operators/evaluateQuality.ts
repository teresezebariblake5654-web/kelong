import { asText, parseNumeric } from './fieldUtils.js';

export type QualityResultType = 'NUMERIC' | 'BOOLEAN' | 'ENUM';

export function normalizeComparableText(value: unknown): string {
  return asText(value).replace(/\s+/g, '').toLowerCase();
}

export function evaluateQualityLimit(options: {
  result: unknown;
  lowerLimit?: unknown;
  upperLimit?: unknown;
}): { passFlag: boolean; reason: string; normalizedResult: number | null } {
  const value = parseNumeric(options.result);
  if (value === null) {
    return { passFlag: false, reason: '结果无法转为数值', normalizedResult: null };
  }
  const lower = parseNumeric(options.lowerLimit);
  const upper = parseNumeric(options.upperLimit);
  if (lower === null && upper === null) {
    return { passFlag: false, reason: '缺少数值上下限', normalizedResult: value };
  }
  if (lower !== null && value < lower) {
    return { passFlag: false, reason: '低于下限', normalizedResult: value };
  }
  if (upper !== null && value > upper) {
    return { passFlag: false, reason: '高于上限', normalizedResult: value };
  }
  return { passFlag: true, reason: '数值合格', normalizedResult: value };
}

export function evaluateExpectedValue(options: {
  result: unknown;
  expectedValue: unknown;
  resultType: QualityResultType;
}): { passFlag: boolean; reason: string; normalizedResult: string } {
  const actual = normalizeComparableText(options.result);
  const expected = normalizeComparableText(options.expectedValue);
  if (!expected) {
    return { passFlag: false, reason: '缺少期望值', normalizedResult: actual };
  }
  if (options.resultType === 'BOOLEAN') {
    const truthy = new Set(['true', '1', 'yes', 'y', '是', '合格', 'pass', 'ok']);
    const falsy = new Set(['false', '0', 'no', 'n', '否', '不合格', 'fail']);
    const norm = (value: string) => {
      if (truthy.has(value)) return 'true';
      if (falsy.has(value)) return 'false';
      return value;
    };
    const passFlag = norm(actual) === norm(expected);
    return {
      passFlag,
      reason: passFlag ? '布尔合格' : '布尔不合格',
      normalizedResult: norm(actual),
    };
  }
  const passFlag = actual === expected;
  return {
    passFlag,
    reason: passFlag ? '枚举合格' : '枚举不合格',
    normalizedResult: actual,
  };
}
