import { asText, normalizeHeaderKey } from './fieldUtils.js';

export type ProductionProgressStatus =
  | 'NOT_STARTED'
  | 'ON_TRACK'
  | 'DELAY_RISK'
  | 'OVERDUE'
  | 'HIGH_SCRAP'
  | 'OVERPRODUCTION'
  | 'NO_RECENT_REPORT'
  | 'REPORT_WITHOUT_PLAN'
  | 'PLAN_CONFLICT'
  | 'INVALID_DATA'
  | 'COMPLETED';

const PRIORITY: ProductionProgressStatus[] = [
  'INVALID_DATA',
  'PLAN_CONFLICT',
  'REPORT_WITHOUT_PLAN',
  'OVERDUE',
  'DELAY_RISK',
  'HIGH_SCRAP',
  'OVERPRODUCTION',
  'NO_RECENT_REPORT',
  'COMPLETED',
  'ON_TRACK',
  'NOT_STARTED',
];

export function pickPrimaryStatus(tags: ProductionProgressStatus[]): ProductionProgressStatus {
  for (const status of PRIORITY) {
    if (tags.includes(status)) return status;
  }
  return 'ON_TRACK';
}

export function normalizeProductionReportStatus(raw: unknown): string {
  const text = asText(raw);
  if (!text) return '';
  const key = normalizeHeaderKey(text);
  if (['完成', '完工', 'completed', 'done', 'closed'].some((item) => key.includes(normalizeHeaderKey(item)))) {
    return 'COMPLETED';
  }
  return text;
}
