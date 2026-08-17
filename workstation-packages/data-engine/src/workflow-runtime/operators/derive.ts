import type { DataRow } from '../../types.js';
import { parseNumeric, roundQty } from './fieldUtils.js';

export type WorkflowExpressionErrorCode =
  | 'INVALID_TOKEN'
  | 'UNKNOWN_IDENTIFIER'
  | 'UNKNOWN_FUNCTION'
  | 'EXPRESSION_TOO_LONG'
  | 'DIVIDE_BY_ZERO'
  | 'INVALID_RESULT';

export class WorkflowExpressionError extends Error {
  readonly code: WorkflowExpressionErrorCode;

  constructor(code: WorkflowExpressionErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowExpressionError';
    this.code = code;
  }
}

export type DeriveFieldSpec = string | ((row: DataRow) => unknown);

const MAX_EXPRESSION_LENGTH = 500;

const ALLOWED_FUNCTIONS = new Set([
  'max',
  'min',
  'abs',
  'clamp',
  'round',
  'ceil',
  'floor',
]);

const FORBIDDEN_IDENTIFIERS = new Set([
  'constructor',
  'prototype',
  '__proto__',
  'globalThis',
  'process',
  'Buffer',
  'require',
  'module',
  'exports',
  'eval',
  'Function',
  'window',
  'self',
  'global',
  'fs',
  'import',
]);

/**
 * Deterministic field derivation.
 * String expressions are evaluated by a whitelist recursive-descent parser only.
 * Never uses eval / Function / vm / dynamic import.
 */
export function deriveRows(
  rows: DataRow[],
  fields: Record<string, DeriveFieldSpec>,
): DataRow[] {
  return rows.map((row) => {
    const next: DataRow = { ...row };
    for (const [name, spec] of Object.entries(fields)) {
      if (typeof spec === 'function') {
        next[name] = spec(next);
      } else {
        const value = evaluateExpression(spec, next);
        next[name] = typeof value === 'number' ? roundQty(value, 8) : value;
      }
    }
    return next;
  });
}

export function evaluateExpression(expression: string, row: DataRow): number {
  if (typeof expression !== 'string') {
    throw new WorkflowExpressionError('INVALID_TOKEN', 'Expression must be a string');
  }
  const text = expression.trim();
  if (!text) {
    throw new WorkflowExpressionError('INVALID_TOKEN', 'Expression is empty');
  }
  if (text.length > MAX_EXPRESSION_LENGTH) {
    throw new WorkflowExpressionError(
      'EXPRESSION_TOO_LONG',
      `Expression exceeds ${MAX_EXPRESSION_LENGTH} characters`,
    );
  }

  const tokens = tokenize(text);
  let index = 0;
  const peek = () => tokens[index];
  const consume = () => tokens[index++];

  function expect(value: string): void {
    const token = consume();
    if (!token || token.value !== value) {
      throw new WorkflowExpressionError('INVALID_TOKEN', `Expected '${value}'`);
    }
  }

  function finishNumber(value: number): number {
    if (!Number.isFinite(value)) {
      throw new WorkflowExpressionError('INVALID_RESULT', `Non-finite result: ${value}`);
    }
    return value;
  }

  function readIdentifierValue(name: string): number {
    if (FORBIDDEN_IDENTIFIERS.has(name)) {
      throw new WorkflowExpressionError(
        'UNKNOWN_IDENTIFIER',
        `Forbidden identifier: ${name}`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(row, name)) {
      throw new WorkflowExpressionError(
        'UNKNOWN_IDENTIFIER',
        `Unknown field: ${name}`,
      );
    }
    const num = parseNumeric(row[name]);
    if (num === null) {
      throw new WorkflowExpressionError(
        'INVALID_RESULT',
        `Field '${name}' is not a finite number`,
      );
    }
    return finishNumber(num);
  }

  function callFunction(name: string, args: number[]): number {
    if (!ALLOWED_FUNCTIONS.has(name)) {
      throw new WorkflowExpressionError('UNKNOWN_FUNCTION', `Unknown function: ${name}`);
    }
    switch (name) {
      case 'abs':
        if (args.length !== 1) {
          throw new WorkflowExpressionError('INVALID_TOKEN', 'abs() expects 1 argument');
        }
        return finishNumber(Math.abs(args[0]!));
      case 'max':
        if (args.length < 1) {
          throw new WorkflowExpressionError('INVALID_TOKEN', 'max() expects >= 1 argument');
        }
        return finishNumber(Math.max(...args));
      case 'min':
        if (args.length < 1) {
          throw new WorkflowExpressionError('INVALID_TOKEN', 'min() expects >= 1 argument');
        }
        return finishNumber(Math.min(...args));
      case 'clamp':
        if (args.length !== 3) {
          throw new WorkflowExpressionError('INVALID_TOKEN', 'clamp() expects 3 arguments');
        }
        return finishNumber(Math.min(Math.max(args[0]!, args[1]!), args[2]!));
      case 'round':
        if (args.length < 1 || args.length > 2) {
          throw new WorkflowExpressionError('INVALID_TOKEN', 'round() expects 1 or 2 arguments');
        }
        if (args.length === 1) return finishNumber(Math.round(args[0]!));
        return finishNumber(roundQty(args[0]!, Math.trunc(args[1]!)));
      case 'ceil':
        if (args.length !== 1) {
          throw new WorkflowExpressionError('INVALID_TOKEN', 'ceil() expects 1 argument');
        }
        return finishNumber(Math.ceil(args[0]!));
      case 'floor':
        if (args.length !== 1) {
          throw new WorkflowExpressionError('INVALID_TOKEN', 'floor() expects 1 argument');
        }
        return finishNumber(Math.floor(args[0]!));
      default:
        throw new WorkflowExpressionError('UNKNOWN_FUNCTION', `Unknown function: ${name}`);
    }
  }

  function parsePrimary(): number {
    const token = consume();
    if (!token) {
      throw new WorkflowExpressionError('INVALID_TOKEN', 'Unexpected end of expression');
    }
    if (token.type === 'number') return finishNumber(token.value);
    if (token.type === 'ident') {
      if (peek()?.value === '(') {
        consume();
        const args: number[] = [];
        if (peek()?.value !== ')') {
          args.push(parseOr());
          while (peek()?.value === ',') {
            consume();
            args.push(parseOr());
          }
        }
        expect(')');
        return callFunction(token.value, args);
      }
      return readIdentifierValue(token.value);
    }
    if (token.value === '(') {
      const value = parseOr();
      expect(')');
      return value;
    }
    if (token.value === '!') {
      const value = parsePrimary();
      return value ? 0 : 1;
    }
    if (token.value === '-') return finishNumber(-parsePrimary());
    if (token.value === '+') return parsePrimary();
    throw new WorkflowExpressionError('INVALID_TOKEN', `Unexpected token: ${token.value}`);
  }

  function parseMul(): number {
    let value = parsePrimary();
    while (peek()?.value === '*' || peek()?.value === '/' || peek()?.value === '%') {
      const op = consume()!.value;
      const right = parsePrimary();
      if (op === '*') value = value * right;
      else if (op === '/') {
        if (right === 0) {
          throw new WorkflowExpressionError('DIVIDE_BY_ZERO', 'Division by zero');
        }
        value = value / right;
      } else {
        if (right === 0) {
          throw new WorkflowExpressionError('DIVIDE_BY_ZERO', 'Modulo by zero');
        }
        value = value % right;
      }
      value = finishNumber(value);
    }
    return value;
  }

  function parseAdd(): number {
    let value = parseMul();
    while (peek()?.value === '+' || peek()?.value === '-') {
      const op = consume()!.value;
      const right = parseMul();
      value = finishNumber(op === '+' ? value + right : value - right);
    }
    return value;
  }

  function parseCompare(): number {
    let value = parseAdd();
    while (
      peek()?.value === '>' ||
      peek()?.value === '>=' ||
      peek()?.value === '<' ||
      peek()?.value === '<=' ||
      peek()?.value === '==' ||
      peek()?.value === '!='
    ) {
      const op = consume()!.value;
      const right = parseAdd();
      let result = false;
      if (op === '>') result = value > right;
      else if (op === '>=') result = value >= right;
      else if (op === '<') result = value < right;
      else if (op === '<=') result = value <= right;
      else if (op === '==') result = value === right;
      else result = value !== right;
      value = result ? 1 : 0;
    }
    return value;
  }

  function parseAnd(): number {
    let value = parseCompare();
    while (peek()?.value === '&&') {
      consume();
      const right = parseCompare();
      value = value && right ? 1 : 0;
    }
    return value;
  }

  function parseOr(): number {
    let value = parseAnd();
    while (peek()?.value === '||') {
      consume();
      const right = parseAnd();
      value = value || right ? 1 : 0;
    }
    return value;
  }

  const value = parseOr();
  if (index !== tokens.length) {
    throw new WorkflowExpressionError(
      'INVALID_TOKEN',
      `Unexpected token at end: ${peek()?.value ?? ''}`,
    );
  }
  return finishNumber(value);
}

type Token =
  | { type: 'number'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'symbol'; value: string };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(expression[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < expression.length && /[0-9.]/.test(expression[j]!)) j += 1;
      const raw = expression.slice(i, j);
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new WorkflowExpressionError('INVALID_TOKEN', `Invalid number: ${raw}`);
      }
      tokens.push({ type: 'number', value });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < expression.length && /[A-Za-z0-9_]/.test(expression[j]!)) j += 1;
      tokens.push({ type: 'ident', value: expression.slice(i, j) });
      i = j;
      continue;
    }

    const two = expression.slice(i, i + 2);
    if (['>=', '<=', '==', '!=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'symbol', value: two });
      i += 2;
      continue;
    }
    if ('+-*/%()!,<>'.includes(ch)) {
      tokens.push({ type: 'symbol', value: ch });
      i += 1;
      continue;
    }

    throw new WorkflowExpressionError(
      'INVALID_TOKEN',
      `Invalid character in expression: ${ch}`,
    );
  }
  return tokens;
}
