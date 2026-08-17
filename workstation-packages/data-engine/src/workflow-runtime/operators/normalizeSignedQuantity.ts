import type { DataRow } from '../../types.js';
import { asText, parseNumeric, roundQty } from './fieldUtils.js';

export type MovementDirection = 'issue' | 'return' | 'unknown';

const ISSUE_TYPES = ['领料', '生产领用', '出库', 'issue', 'outbound', '领用'];
const RETURN_TYPES = ['退料', '退库', 'return', 'returned'];

export function classifyMovementType(raw: unknown): MovementDirection {
  const text = asText(raw);
  if (!text) return 'unknown';
  const lower = text.toLowerCase();
  if (RETURN_TYPES.some((item) => lower === item.toLowerCase() || text.includes(item))) {
    return 'return';
  }
  if (ISSUE_TYPES.some((item) => lower === item.toLowerCase() || text.includes(item))) {
    return 'issue';
  }
  return 'unknown';
}

/**
 * Normalize signed quantity by movement direction.
 * issue → positive issueQty contribution
 * return → positive returnQty contribution (later subtracted)
 */
export function normalizeSignedQuantityRows(
  rows: DataRow[],
  options?: {
    typeField?: string;
    qtyField?: string;
    issueField?: string;
    returnField?: string;
  },
): DataRow[] {
  const typeField = options?.typeField ?? 'movementType';
  const qtyField = options?.qtyField ?? 'qty';
  const issueField = options?.issueField ?? 'issueQty';
  const returnField = options?.returnField ?? 'returnQty';

  return rows.map((row) => {
    const direction = classifyMovementType(row[typeField]);
    const qty = Math.abs(parseNumeric(row[qtyField]) ?? 0);
    const next: DataRow = {
      ...row,
      movementDirection: direction,
      [issueField]: direction === 'issue' ? roundQty(qty) : 0,
      [returnField]: direction === 'return' ? roundQty(qty) : 0,
    };
    return next;
  });
}
