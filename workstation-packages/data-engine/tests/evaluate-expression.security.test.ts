import { describe, expect, it } from 'vitest';
import {
  evaluateExpression,
  WorkflowExpressionError,
} from '../src/index.js';

describe('evaluateExpression security', () => {
  it('accepts whitelist arithmetic and functions', () => {
    expect(evaluateExpression('max(a - b, 0)', { a: 50, b: 10 })).toBe(40);
    expect(evaluateExpression('clamp(x, 0, 10)', { x: 15 })).toBe(10);
    expect(evaluateExpression('round(x, 2)', { x: 1.239 })).toBe(1.24);
    expect(evaluateExpression('a > b && c != 0', { a: 2, b: 1, c: 3 })).toBe(1);
  });

  it('rejects dangerous and invalid expressions', () => {
    const attacks = [
      'process.exit()',
      'globalThis',
      'constructor.constructor',
      'require("fs")',
      'new Function',
      'eval(1)',
      'foo.bar',
      '__proto__',
    ];
    for (const expression of attacks) {
      expect(() => evaluateExpression(expression, {})).toThrow(WorkflowExpressionError);
    }

    expect(() => evaluateExpression('x'.repeat(501), { x: 1 })).toThrow(
      /EXPRESSION_TOO_LONG|Expression exceeds/,
    );

    try {
      evaluateExpression('1/0', {});
      throw new Error('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowExpressionError);
      expect((error as WorkflowExpressionError).code).toBe('DIVIDE_BY_ZERO');
    }

    try {
      evaluateExpression('missingField + 1', { a: 1 });
      throw new Error('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowExpressionError);
      expect((error as WorkflowExpressionError).code).toBe('UNKNOWN_IDENTIFIER');
    }

    try {
      evaluateExpression('a / b', { a: 1, b: 0 });
      throw new Error('should throw');
    } catch (error) {
      expect((error as WorkflowExpressionError).code).toBe('DIVIDE_BY_ZERO');
    }
  });
});
