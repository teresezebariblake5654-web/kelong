import { createHash, randomUUID } from 'node:crypto';
import type { SourceTraceRef } from '@aw/shared';

export function sha256Buffer(buffer: Buffer | Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function createTraceId(prefix = 'tr'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function buildSourceTrace(input: {
  sourceFile: string;
  sourceSheet: string;
  sourceRow: number;
  workflowVersion: string;
  inputSha256: string;
  role?: string;
}): SourceTraceRef {
  return {
    sourceFile: input.sourceFile,
    sourceSheet: input.sourceSheet,
    sourceRow: input.sourceRow,
    workflowVersion: input.workflowVersion,
    inputSha256: input.inputSha256,
    role: input.role,
    traceId: createTraceId(),
  };
}

export function mergeSourceRows(refs: Array<Pick<SourceTraceRef, 'sourceRow'>>): string {
  const rows = [...new Set(refs.map((ref) => ref.sourceRow))].sort((a, b) => a - b);
  return rows.join(',');
}

export function attachTraceFields<T extends Record<string, unknown>>(
  row: T,
  trace: SourceTraceRef,
): T & {
  sourceFile: string;
  sourceSheet: string;
  sourceRow: number | string;
  workflowVersion: string;
  inputSha256: string;
  traceId: string;
} {
  return {
    ...row,
    sourceFile: trace.sourceFile,
    sourceSheet: trace.sourceSheet,
    sourceRow: trace.sourceRow,
    workflowVersion: trace.workflowVersion,
    inputSha256: trace.inputSha256,
    traceId: trace.traceId ?? createTraceId(),
  };
}
