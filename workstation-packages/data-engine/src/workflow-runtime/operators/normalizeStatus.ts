import { asText, normalizeHeaderKey } from './fieldUtils.js';

export type NormalizedPlanStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'RELEASED'
  | 'READY'
  | 'STARTED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'CLOSED'
  | 'UNKNOWN';

const PLAN_STATUS_ALIASES: Record<NormalizedPlanStatus, string[]> = {
  DRAFT: ['草稿', '未审核', 'draft', 'new'],
  APPROVED: ['已审核', '已批准', 'approved', '审核通过'],
  RELEASED: ['已下达', '已释放', 'released', '下达'],
  READY: ['待生产', '可生产', 'ready', '就绪'],
  STARTED: ['生产中', '已开工', 'started', 'in_progress', '进行中'],
  COMPLETED: ['已完成', '完工', 'completed', 'done'],
  CANCELLED: ['已取消', '作废', 'cancelled', 'canceled', '作废'],
  CLOSED: ['已关闭', '已结案', 'closed', '结案'],
  UNKNOWN: [],
};

const LOOKUP = new Map<string, NormalizedPlanStatus>();
for (const [status, aliases] of Object.entries(PLAN_STATUS_ALIASES) as Array<
  [NormalizedPlanStatus, string[]]
>) {
  LOOKUP.set(normalizeHeaderKey(status), status);
  for (const alias of aliases) {
    LOOKUP.set(normalizeHeaderKey(alias), status);
  }
}

export function normalizePlanStatus(raw: unknown): NormalizedPlanStatus {
  const text = asText(raw);
  if (!text) return 'UNKNOWN';
  return LOOKUP.get(normalizeHeaderKey(text)) ?? 'UNKNOWN';
}

export function normalizeStatusField<T extends Record<string, unknown>>(
  rows: T[],
  options?: {
    sourceField?: string;
    targetField?: string;
  },
): Array<T & { normalizedStatus: NormalizedPlanStatus }> {
  const sourceField = options?.sourceField ?? 'planStatus';
  const targetField = options?.targetField ?? 'normalizedStatus';
  return rows.map((row) => ({
    ...row,
    [targetField]: normalizePlanStatus(row[sourceField]),
  })) as Array<T & { normalizedStatus: NormalizedPlanStatus }>;
}
