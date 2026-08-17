import { parseYmd } from './normalizeDate.js';

/** Calendar-day difference (to - from), timezone-stable via UTC midnight. */
export function daysBetween(fromYmd: string, toYmd: string): number | null {
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  if (!from || !to) return null;
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / 86_400_000);
}

export function isInFreezeWindow(options: {
  plannedStartYmd: string | null;
  runDateYmd: string;
  freezeDays: number;
}): boolean {
  if (!options.plannedStartYmd) return false;
  const daysToStart = daysBetween(options.runDateYmd, options.plannedStartYmd);
  if (daysToStart === null) return false;
  return daysToStart >= 0 && daysToStart <= options.freezeDays;
}

export function addDaysYmd(ymd: string, days: number): string | null {
  const parts = parseYmd(ymd);
  if (!parts) return null;
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day) + days * 86_400_000;
  const dt = new Date(utc);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
