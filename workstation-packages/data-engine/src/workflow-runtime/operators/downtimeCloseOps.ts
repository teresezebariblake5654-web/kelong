import type { DataRow } from '../../types.js';
import { asText, parseNumeric, roundQty } from './fieldUtils.js';

export function aggregateDowntimeReason(
  rows: DataRow[],
  options?: { reasonField?: string; minutesField?: string },
): DataRow[] {
  const reasonField = options?.reasonField ?? 'reason';
  const minutesField = options?.minutesField ?? 'netDowntimeMinutes';
  const map = new Map<string, number>();
  for (const row of rows) {
    const reason = asText(row[reasonField]) || 'UNKNOWN';
    const minutes = parseNumeric(row[minutesField]) ?? 0;
    map.set(reason, (map.get(reason) ?? 0) + minutes);
  }
  return [...map.entries()]
    .map(([reason, minutes]) => ({
      reason,
      netDowntimeMinutes: roundQty(minutes, 4),
    }))
    .sort((a, b) => b.netDowntimeMinutes - a.netDowntimeMinutes || a.reason.localeCompare(b.reason));
}

export type ChecklistItem = {
  code: string;
  passed: boolean;
  required: boolean;
  message: string;
};

export function evaluateChecklist(items: ChecklistItem[]): {
  decision: 'CLOSABLE' | 'BLOCKED' | 'NEEDS_REVIEW';
  blockingCodes: string[];
  blockingReasons: string[];
} {
  const blockingCodes: string[] = [];
  const blockingReasons: string[] = [];
  let needsReview = false;

  for (const item of items) {
    if (item.passed) continue;
    if (!item.required) {
      needsReview = true;
      blockingCodes.push(item.code);
      blockingReasons.push(item.message);
      continue;
    }
    blockingCodes.push(item.code);
    blockingReasons.push(item.message);
  }

  if (blockingCodes.length === 0) {
    return { decision: 'CLOSABLE', blockingCodes: [], blockingReasons: [] };
  }
  if (needsReview && blockingCodes.every((code) =>
    ['RATE_MISSING', 'MATERIAL_DATA_MISSING', 'DOWNTIME_OVERLAP', 'INVALID_DOWNTIME_INTERVAL'].includes(code),
  )) {
    return { decision: 'NEEDS_REVIEW', blockingCodes, blockingReasons };
  }
  // Mixed: if any hard block codes present → BLOCKED, else NEEDS_REVIEW
  const hard = blockingCodes.some((code) =>
    [
      'OUTPUT_INCOMPLETE',
      'MATERIAL_UNBALANCED',
      'QUALITY_OPEN',
      'CRITICAL_QUALITY_OPEN',
      'POST_CLOSE_TRANSACTION',
      'INVALID_WORK_ORDER_STATUS',
    ].includes(code),
  );
  return {
    decision: hard ? 'BLOCKED' : 'NEEDS_REVIEW',
    blockingCodes,
    blockingReasons,
  };
}

export function detectPostCloseTransactions(options: {
  closedAtMs: number | null;
  eventTimestampsMs: number[];
}): boolean {
  if (options.closedAtMs === null) return false;
  return options.eventTimestampsMs.some((ts) => ts > options.closedAtMs!);
}
