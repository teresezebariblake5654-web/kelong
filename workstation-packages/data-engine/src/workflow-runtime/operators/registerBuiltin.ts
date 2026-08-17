import type { OperatorRegistry } from '../OperatorRegistry.js';
import type { OperatorFn } from '../types.js';
import { aggregateRows } from './aggregate.js';
import { classifyRows } from './classify.js';
import { deriveRows } from './derive.js';
import { joinRows } from './join.js';
import { normalizeSignedQuantityRows } from './normalizeSignedQuantity.js';

/**
 * Register callable operators. Domain handlers should prefer importing pure helpers
 * directly; registry enables future step-driven execution.
 */
export function registerBuiltinOperators(registry: OperatorRegistry): void {
  const joinOp: OperatorFn = (ctx, params) => {
    const leftName = String(params?.left ?? '');
    const rightName = String(params?.right ?? '');
    const keys = (params?.keys as string[]) ?? [];
    const joinType = (params?.joinType as 'inner' | 'left' | 'full') ?? 'full';
    const left = ctx.resultTables.get(leftName) ?? [];
    const right = ctx.resultTables.get(rightName) ?? [];
    const outName = String(params?.as ?? 'joined');
    ctx.resultTables.set(outName, joinRows({ left, right, keys, joinType }));
  };

  const aggregateOp: OperatorFn = (ctx, params) => {
    const from = String(params?.from ?? '');
    const groupBy = (params?.groupBy as string[]) ?? [];
    const metrics = (params?.metrics as Record<string, 'sum'>) ?? {};
    const rows = ctx.resultTables.get(from) ?? [];
    const outName = String(params?.as ?? from);
    ctx.resultTables.set(outName, aggregateRows(rows, { groupBy, metrics }));
  };

  const deriveOp: OperatorFn = (ctx, params) => {
    const from = String(params?.from ?? '');
    const fields = (params?.fields as Record<string, string>) ?? {};
    const rows = ctx.resultTables.get(from) ?? [];
    const outName = String(params?.as ?? from);
    ctx.resultTables.set(outName, deriveRows(rows, fields));
  };

  const classifyOp: OperatorFn = (ctx, params) => {
    const from = String(params?.from ?? '');
    const rows = ctx.resultTables.get(from) ?? [];
    const outName = String(params?.as ?? from);
    // Step-driven classify rules are supplied by workflow handlers for now.
    ctx.resultTables.set(outName, classifyRows(rows, []));
  };

  const signedOp: OperatorFn = (ctx, params) => {
    const from = String(params?.from ?? '');
    const rows = ctx.resultTables.get(from) ?? [];
    const outName = String(params?.as ?? from);
    ctx.resultTables.set(outName, normalizeSignedQuantityRows(rows));
  };

  const noop: OperatorFn = () => undefined;

  registry.register('loadWorkbook', noop);
  registry.register('detectHeader', noop);
  registry.register('normalizeColumns', noop);
  registry.register('inferTypes', noop);
  registry.register('validateRequiredFields', noop);
  registry.register('deduplicate', noop);
  registry.register('join', joinOp);
  registry.register('aggregate', aggregateOp);
  registry.register('derive', deriveOp);
  registry.register('filter', noop);
  registry.register('classify', classifyOp);
  registry.register('normalizeSignedQuantity', signedOp);
  registry.register('buildSourceTrace', noop);
  registry.register('exportWorkbook', noop);
  registry.register('buildAiSummaryPayload', noop);
  registry.register('mapMovementType', noop);
}
