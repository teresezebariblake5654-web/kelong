import {
  getTaskTemplate,
  type AnomalyRule,
  type FieldDataType,
  type LocalOperation,
  type TaskTemplateDefinition,
} from '@aw/task-templates';
import type {
  AmbiguousColumn,
  ColumnProfile,
  ColumnType,
  DataRow,
  ExecutionWarning,
  MatchedColumn,
  SheetData,
  TemplateAnomaly,
  TemplateExecutionResult,
  UnmatchedColumn,
} from './types.js';

const DAY_MS = 86_400_000;

function empty(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (['true', 'yes', 'y', '是', '1'].includes(text)) return true;
  if (['false', 'no', 'n', '否', '0'].includes(text)) return false;
  return null;
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (empty(value)) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function convert(value: unknown, type: FieldDataType): unknown {
  if (empty(value)) return null;
  if (type === 'number') return numberValue(value) ?? value;
  if (type === 'integer') {
    const parsed = numberValue(value);
    return parsed === null ? value : Math.trunc(parsed);
  }
  if (type === 'boolean') return booleanValue(value) ?? value;
  if (type === 'date' || type === 'datetime') {
    const parsed = dateValue(value);
    if (!parsed) return value;
    return type === 'date' ? parsed.toISOString().slice(0, 10) : parsed.toISOString();
  }
  return String(value).trim();
}

function compatibleType(expected: FieldDataType, detected: ColumnType): boolean {
  if (detected === 'empty') return true;
  if (expected === 'integer' || expected === 'number') return detected === 'number';
  if (expected === 'date' || expected === 'datetime') return detected === 'date';
  return expected === detected;
}

function distinctKey(row: DataRow, fields: string[]): string {
  return fields.map((field) => JSON.stringify(row[field] ?? null)).join('|');
}

function aggregate(values: unknown[], operation: Extract<LocalOperation, { type: 'aggregate' }>['operation']): number | null {
  if (operation === 'count') return values.filter((value) => !empty(value)).length;
  if (operation === 'count-distinct') {
    return new Set(values.filter((value) => !empty(value)).map((value) => JSON.stringify(value))).size;
  }
  const numbers = values.map(numberValue).filter((value): value is number => value !== null);
  if (!numbers.length) return null;
  if (operation === 'sum') return numbers.reduce((sum, value) => sum + value, 0);
  if (operation === 'avg') return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  if (operation === 'min') return Math.min(...numbers);
  return Math.max(...numbers);
}

function arithmeticTokens(expression: string): string[] | null {
  const tokens = expression.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[()+\-*/]/g);
  if (!tokens || tokens.join('') !== expression.replace(/\s+/g, '')) return null;
  return tokens;
}

function evaluateExpression(expression: string, values: DataRow): number | null {
  const directDifference = expression.replace(/\s+/g, '').match(/^([A-Za-z_]\w*)-([A-Za-z_]\w*)$/);
  if (directDifference) {
    const leftDate = dateValue(values[directDifference[1]!]);
    const rightDate = dateValue(values[directDifference[2]!]);
    if (leftDate && rightDate) return (leftDate.getTime() - rightDate.getTime()) / DAY_MS;
  }

  const tokens = arithmeticTokens(expression);
  if (!tokens) return null;
  let index = 0;
  const parsePrimary = (): number | null => {
    const token = tokens[index++];
    if (!token) return null;
    if (token === '(') {
      const result = parseAddSub();
      if (tokens[index++] !== ')') return null;
      return result;
    }
    if (token === '-') {
      const result = parsePrimary();
      return result === null ? null : -result;
    }
    if (/^\d/.test(token)) return Number(token);
    return numberValue(values[token]);
  };
  const parseMulDiv = (): number | null => {
    let result = parsePrimary();
    while (tokens[index] === '*' || tokens[index] === '/') {
      const operator = tokens[index++];
      const right = parsePrimary();
      if (result === null || right === null || (operator === '/' && right === 0)) return null;
      result = operator === '*' ? result * right : result / right;
    }
    return result;
  };
  const parseAddSub = (): number | null => {
    let result = parseMulDiv();
    while (tokens[index] === '+' || tokens[index] === '-') {
      const operator = tokens[index++];
      const right = parseMulDiv();
      if (result === null || right === null) return null;
      result = operator === '+' ? result + right : result - right;
    }
    return result;
  };
  const result = parseAddSub();
  return index === tokens.length ? result : null;
}

function compare(left: unknown, operator: AnomalyRule['operator'], right: unknown): boolean {
  if (operator === 'missing') return empty(left);
  if (operator === 'duplicate' || operator === 'deviation') return false;
  if (operator === 'eq' || operator === 'neq') {
    const equal = String(left ?? '') === String(right ?? '');
    return operator === 'eq' ? equal : !equal;
  }
  const value = numberValue(left);
  if (value === null) return false;
  if (operator === 'between' || operator === 'outside') {
    const bounds = Array.isArray(right) ? right.map(numberValue) : [];
    if (bounds.length !== 2 || bounds[0] === null || bounds[1] === null) return false;
    const inside = value >= bounds[0]! && value <= bounds[1]!;
    return operator === 'between' ? inside : !inside;
  }
  const target = numberValue(right);
  if (target === null) return false;
  if (operator === 'gt') return value > target;
  if (operator === 'gte') return value >= target;
  if (operator === 'lt') return value < target;
  return value <= target;
}

function matchesFilter(value: unknown, operation: Extract<LocalOperation, { type: 'filter' }>): boolean {
  if (operation.operator === 'not-empty') return !empty(value);
  if (operation.operator === 'in') {
    return Array.isArray(operation.value) && operation.value.some((item) => String(item) === String(value));
  }
  return compare(value, operation.operator, operation.value);
}

function groupRows(
  rows: DataRow[],
  groupFields: string[],
  aggregates: Array<Extract<LocalOperation, { type: 'aggregate' }>>,
): Array<Record<string, unknown>> {
  if (!groupFields.length) return [];
  const buckets = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = distinctKey(row, groupFields);
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map((bucket) => {
    const result: Record<string, unknown> = { count: bucket.length };
    for (const field of groupFields) result[field] = bucket[0]?.[field] ?? null;
    for (const spec of aggregates) {
      result[spec.as] = aggregate(bucket.map((row) => row[spec.field]), spec.operation);
    }
    return result;
  });
}

function addAnomalies(
  rows: DataRow[],
  rules: readonly AnomalyRule[],
  sourceByField: Map<string, string>,
): TemplateAnomaly[] {
  const anomalies: TemplateAnomaly[] = [];
  for (const rule of rules) {
    if (rule.operator === 'duplicate') {
      const counts = new Map<string, number>();
      rows.forEach((row) => {
        const key = JSON.stringify(row[rule.field] ?? null);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });
      rows.forEach((row, rowIndex) => {
        const key = JSON.stringify(row[rule.field] ?? null);
        if (!empty(row[rule.field]) && (counts.get(key) ?? 0) > 1) {
          anomalies.push(makeAnomaly(rule, row, rowIndex, sourceByField));
        }
      });
      continue;
    }

    if (rule.operator === 'deviation') {
      const threshold = numberValue(rule.value) ?? 2;
      const dated = rows.map((row) => dateValue(row[rule.field]));
      if (dated.some(Boolean)) {
        rows.forEach((row, rowIndex) => {
          const date = dateValue(row[rule.field]);
          if (date && (Date.now() - date.getTime()) / DAY_MS > threshold) {
            anomalies.push(makeAnomaly(rule, row, rowIndex, sourceByField));
          }
        });
        continue;
      }
      const numbers = rows.map((row) => numberValue(row[rule.field])).filter((value): value is number => value !== null);
      if (numbers.length >= 2) {
        const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
        const deviation = Math.sqrt(numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numbers.length);
        rows.forEach((row, rowIndex) => {
          const value = numberValue(row[rule.field]);
          if (value !== null && deviation > 0 && Math.abs(value - mean) / deviation >= threshold) {
            anomalies.push(makeAnomaly(rule, row, rowIndex, sourceByField));
          }
        });
      }
      continue;
    }

    rows.forEach((row, rowIndex) => {
      if (compare(row[rule.field], rule.operator, rule.value)) {
        anomalies.push(makeAnomaly(rule, row, rowIndex, sourceByField));
      }
    });
  }
  return anomalies;
}

function makeAnomaly(
  rule: AnomalyRule,
  row: DataRow,
  rowIndex: number,
  sourceByField: Map<string, string>,
): TemplateAnomaly {
  return {
    ruleCode: rule.code,
    ruleName: rule.name,
    rowIndex,
    field: rule.field,
    sourceColumn: sourceByField.get(rule.field),
    value: row[rule.field],
    severity: rule.severity,
    message: rule.message,
  };
}

function matchColumns(template: TaskTemplateDefinition, sheet: SheetData) {
  const matchedColumns: MatchedColumn[] = [];
  const unmatchedColumns: UnmatchedColumn[] = [];
  const ambiguousColumns: AmbiguousColumn[] = [];
  const sourceByField = new Map<string, string>();
  const profileByName = new Map(sheet.columnProfiles.map((profile) => [profile.name, profile]));

  for (const field of template.fields) {
    const aliases = new Set(field.aliases.map(normalized));
    const candidates = sheet.headers.filter((header) => {
      const headerName = normalized(header);
      if (aliases.has(headerName)) return true;
      return [...aliases].some((alias) =>
        alias.length >= 2
        && headerName.length > alias.length
        && (headerName.startsWith(alias) || headerName.endsWith(alias)),
      );
    });
    if (candidates.length === 0) {
      unmatchedColumns.push({
        fieldKey: field.key,
        fieldLabel: field.label,
        required: field.required,
        aliases: field.aliases,
      });
      continue;
    }
    if (candidates.length > 1) {
      ambiguousColumns.push({
        fieldKey: field.key,
        fieldLabel: field.label,
        candidateColumns: candidates,
      });
      continue;
    }
    const sourceColumn = candidates[0]!;
    const profile = profileByName.get(sourceColumn) as ColumnProfile | undefined;
    const confidence = aliases.has(normalized(sourceColumn)) ? 1 : 0.9;
    sourceByField.set(field.key, sourceColumn);
    matchedColumns.push({
      fieldKey: field.key,
      fieldLabel: field.label,
      sourceColumn,
      expectedType: field.dataType,
      detectedType: profile?.type ?? 'empty',
      confidence,
    });
  }
  return { matchedColumns, unmatchedColumns, ambiguousColumns, sourceByField };
}

export function executeTaskTemplate(input: {
  templateCode: string;
  templateVersion?: string;
  sheet: SheetData;
}): TemplateExecutionResult {
  const template = getTaskTemplate(input.templateCode, input.templateVersion ?? '1.0.0');
  if (!template || !template.enabled) throw new Error(`未找到可用任务模板: ${input.templateCode}`);

  const mapping = matchColumns(template, input.sheet);
  const warnings: ExecutionWarning[] = [];
  for (const field of mapping.unmatchedColumns.filter((item) => item.required)) {
    warnings.push({
      code: 'REQUIRED_FIELD_MISSING',
      fieldKey: field.fieldKey,
      message: `缺少必要字段“${field.fieldLabel}”`,
    });
  }
  for (const field of mapping.ambiguousColumns) {
    warnings.push({
      code: 'AMBIGUOUS_FIELD',
      fieldKey: field.fieldKey,
      message: `字段“${field.fieldLabel}”匹配到多个列: ${field.candidateColumns.join('、')}`,
    });
  }

  const fieldByKey = new Map(template.fields.map((field) => [field.key, field]));
  const profileByName = new Map(input.sheet.columnProfiles.map((profile) => [profile.name, profile]));
  for (const match of mapping.matchedColumns) {
    const field = fieldByKey.get(match.fieldKey)!;
    const profile = profileByName.get(match.sourceColumn);
    if (profile && !compatibleType(field.dataType, profile.type)) {
      warnings.push({
        code: 'TYPE_MISMATCH',
        fieldKey: field.key,
        message: `字段“${field.label}”期望 ${field.dataType}，识别为 ${profile.type}`,
      });
    }
  }

  let rows = input.sheet.rows.map((sourceRow, rowIndex) => {
    const row: DataRow = { __sourceRowIndex: rowIndex };
    for (const match of mapping.matchedColumns) {
      const field = fieldByKey.get(match.fieldKey)!;
      const original = sourceRow[match.sourceColumn];
      const converted = convert(original, field.dataType);
      row[field.key] = converted;
      if (!empty(original) && field.dataType !== 'string' && converted === original && typeof original === 'string') {
        warnings.push({
          code: 'TYPE_MISMATCH',
          fieldKey: field.key,
          rowIndex,
          message: `第 ${rowIndex + 1} 行“${field.label}”无法转换为 ${field.dataType}`,
        });
      }
    }
    return row;
  });

  const anomaliesBeforeOperations = addAnomalies(
    rows,
    template.anomalyRules.filter((rule) => rule.operator === 'duplicate'),
    mapping.sourceByField,
  );
  const rowCountBeforeCleaning = rows.length;
  let duplicateRowsRemoved = 0;
  let groupFields: string[] = [];
  const aggregateOperations: Array<Extract<LocalOperation, { type: 'aggregate' }>> = [];
  const deriveOperations: Array<Extract<LocalOperation, { type: 'derive' }>> = [];
  const sortOperations: Array<Extract<LocalOperation, { type: 'sort' }>> = [];

  for (const operation of template.localOperations) {
    if (operation.type === 'deduplicate') {
      const seen = new Set<string>();
      const source = operation.keep === 'last' ? [...rows].reverse() : rows;
      rows = source.filter((row) => {
        const key = distinctKey(row, operation.fields);
        if (seen.has(key)) {
          duplicateRowsRemoved += 1;
          return false;
        }
        seen.add(key);
        return true;
      });
      if (operation.keep === 'last') rows.reverse();
    } else if (operation.type === 'filter') {
      rows = rows.filter((row) => matchesFilter(row[operation.field], operation));
    } else if (operation.type === 'group') {
      groupFields = operation.fields;
    } else if (operation.type === 'aggregate') {
      aggregateOperations.push(operation);
    } else if (operation.type === 'derive') {
      deriveOperations.push(operation);
    } else if (operation.type === 'sort') {
      sortOperations.push(operation);
    } else if (operation.type === 'limit') {
      rows = rows.slice(0, operation.count);
    }
  }

  for (const operation of deriveOperations) {
    let applied = false;
    rows = rows.map((row) => {
      const value = evaluateExpression(operation.expression, row);
      if (value === null) return row;
      applied = true;
      return { ...row, [operation.as]: value };
    });
    if (!applied) {
      warnings.push({
        code: 'OPERATION_SKIPPED',
        fieldKey: operation.as,
        message: `无法在明细行执行计算“${operation.description}”，将尝试在分组统计中执行`,
      });
    }
  }

  const aggregates: Record<string, number | null> = {};
  for (const operation of aggregateOperations) {
    aggregates[operation.as] = aggregate(rows.map((row) => row[operation.field]), operation.operation);
  }
  let groups = groupRows(rows, groupFields, aggregateOperations);
  for (const operation of deriveOperations) {
    groups = groups.map((group) => {
      const value = evaluateExpression(operation.expression, group);
      return value === null ? group : { ...group, [operation.as]: value };
    });
    const aggregateValue = evaluateExpression(operation.expression, { ...aggregates });
    if (aggregateValue !== null) aggregates[operation.as] = aggregateValue;
  }

  for (const operation of sortOperations) {
    const direction = operation.direction === 'asc' ? 1 : -1;
    const compareRows = (left: DataRow, right: DataRow) => {
      const a = numberValue(left[operation.field]);
      const b = numberValue(right[operation.field]);
      if (a !== null && b !== null) return (a - b) * direction;
      return String(left[operation.field] ?? '').localeCompare(String(right[operation.field] ?? ''), 'zh-CN') * direction;
    };
    if (groups.some((group) => operation.field in group)) groups.sort(compareRows);
    else rows.sort(compareRows);
  }

  const regularRules = template.anomalyRules.filter((rule) => rule.operator !== 'duplicate');
  const anomalyRows = new Map<string, DataRow[]>();
  for (const rule of regularRules) {
    const candidates = groups.some((group) => rule.field in group) ? groups : rows;
    anomalyRows.set(rule.code, candidates);
  }
  const anomalies = [...anomaliesBeforeOperations];
  for (const rule of regularRules) {
    anomalies.push(...addAnomalies(anomalyRows.get(rule.code) ?? [], [rule], mapping.sourceByField));
  }

  return {
    templateCode: template.code,
    templateVersion: template.version,
    matchedColumns: mapping.matchedColumns,
    unmatchedColumns: mapping.unmatchedColumns,
    ambiguousColumns: mapping.ambiguousColumns,
    cleanedRows: rows.map(({ __sourceRowIndex: _, ...row }) => row),
    anomalies,
    warnings,
    statistics: {
      rowCountBeforeCleaning,
      rowCountAfterCleaning: rows.length,
      duplicateRowsRemoved,
      aggregates,
      groups,
    },
  };
}
