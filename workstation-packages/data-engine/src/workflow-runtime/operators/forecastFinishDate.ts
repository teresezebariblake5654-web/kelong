import { asText, parseNumeric } from './fieldUtils.js';
import { parseYmd } from './normalizeDate.js';
import type { DataRow } from '../../types.js';
import { addDaysYmd, daysBetween } from './dateWindow.js';

export type WorkCalendarDay = {
  date: string;
  isWorkday: boolean;
  availableHours?: number;
};

export function workingDayDifference(
  fromYmd: string,
  toYmd: string,
  calendar: WorkCalendarDay[],
): number | null {
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  if (!from || !to) return null;
  const map = new Map(calendar.map((day) => [day.date, day]));
  let cursor = fromYmd;
  let count = 0;
  const step = (daysBetween(fromYmd, toYmd) ?? 0) >= 0 ? 1 : -1;
  if (fromYmd === toYmd) return 0;
  while (cursor !== toYmd) {
    const next = addDaysYmd(cursor, step);
    if (!next) return null;
    cursor = next;
    const day = map.get(cursor);
    if (day ? day.isWorkday : true) count += step;
    if (Math.abs(count) > 3660) return null;
  }
  return count;
}

export function workingDayAdd(
  fromYmd: string,
  workdays: number,
  calendar: WorkCalendarDay[],
  options?: { defaultHours?: number },
): string | null {
  if (!parseYmd(fromYmd)) return null;
  if (workdays === 0) return fromYmd;
  const map = new Map(calendar.map((day) => [day.date, day]));
  let cursor = fromYmd;
  let remaining = Math.abs(workdays);
  const step = workdays > 0 ? 1 : -1;
  let guard = 0;
  while (remaining > 0 && guard < 5000) {
    guard += 1;
    const next = addDaysYmd(cursor, step);
    if (!next) return null;
    cursor = next;
    const day = map.get(cursor);
    const isWorkday = day ? day.isWorkday : true;
    if (isWorkday) remaining -= 1;
  }
  void options;
  return cursor;
}

/**
 * Forecast finish date from remaining hours.
 * WORKDAY mode consumes calendar availableHours (or defaultWorkdayHours).
 * NATURAL_DAY mode divides by defaultWorkdayHours.
 */
export function forecastFinishDate(options: {
  runDate: string;
  remainingHours: number | null;
  calendarMode: 'NATURAL_DAY' | 'WORKDAY';
  defaultWorkdayHours: number;
  calendar?: WorkCalendarDay[];
}): string | null {
  if (options.remainingHours === null || !Number.isFinite(options.remainingHours)) {
    return null;
  }
  if (options.remainingHours <= 0) return options.runDate;
  if (options.defaultWorkdayHours <= 0) return null;

  if (options.calendarMode === 'NATURAL_DAY') {
    const days = Math.ceil(options.remainingHours / options.defaultWorkdayHours);
    return addDaysYmd(options.runDate, days);
  }

  const calendar = options.calendar ?? [];
  const map = new Map(calendar.map((day) => [day.date, day]));
  let remaining = options.remainingHours;
  let cursor = options.runDate;
  let guard = 0;
  while (remaining > 0 && guard < 5000) {
    guard += 1;
    const next = addDaysYmd(cursor, 1);
    if (!next) return null;
    cursor = next;
    const day = map.get(cursor);
    if (day && !day.isWorkday) continue;
    const hours =
      day?.availableHours !== undefined && day.availableHours !== null
        ? Number(day.availableHours)
        : options.defaultWorkdayHours;
    if (!(hours > 0)) continue;
    remaining -= hours;
  }
  return cursor;
}

export function buildWorkCalendar(rows: DataRow[]): WorkCalendarDay[] {
  return rows
    .map((row) => {
      const date = asText(row.date);
      const flag = asText(row.isWorkday).toLowerCase();
      const isWorkday =
        flag === '1' ||
        flag === 'true' ||
        flag === 'yes' ||
        flag === '是' ||
        flag === 'y' ||
        row.isWorkday === true ||
        row.isWorkday === 1;
      return {
        date,
        isWorkday,
        availableHours: parseNumeric(row.availableHours) ?? undefined,
      };
    })
    .filter((day) => Boolean(day.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}
