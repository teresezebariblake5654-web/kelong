import { asText } from './fieldUtils.js';
import { normalizeDate, formatYmd } from './normalizeDate.js';

export type NormalizeDateTimeResult =
  | { ok: true; iso: string; epochMs: number }
  | { ok: false; reason: string };

/**
 * Normalize datetime to a timezone-stable ISO string.
 * Naive datetimes are interpreted in the provided timezone offset hours (default UTC).
 */
export function normalizeDateTime(
  input: unknown,
  options?: { timezone?: string },
): NormalizeDateTimeResult {
  const timezone = options?.timezone ?? 'UTC';
  const offsetHours = timezoneOffsetHours(timezone);

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return { ok: false, reason: 'Invalid Date' };
    return { ok: true, iso: input.toISOString(), epochMs: input.getTime() };
  }

  if (typeof input === 'number' && Number.isFinite(input)) {
    // Excel datetime serial
    const datePart = Math.floor(input);
    const timePart = input - datePart;
    const date = normalizeDate(datePart, { excelDateSystem: '1900' });
    if (!date.ok) return { ok: false, reason: date.reason };
    const msInDay = Math.round(timePart * 86_400_000);
    const [y, m, d] = date.value.split('-').map(Number);
    const epochMs = Date.UTC(y!, m! - 1, d!) + msInDay - offsetHours * 3_600_000;
    return { ok: true, iso: new Date(epochMs).toISOString(), epochMs };
  }

  const text = asText(input);
  if (!text) return { ok: false, reason: 'Empty datetime' };

  // Date only
  const dateOnly = normalizeDate(text);
  if (dateOnly.ok && !/[T\s]\d/.test(text)) {
    const [y, m, d] = dateOnly.value.split('-').map(Number);
    const epochMs = Date.UTC(y!, m! - 1, d!) - offsetHours * 3_600_000;
    return { ok: true, iso: new Date(epochMs).toISOString(), epochMs };
  }

  // YYYY-MM-DD HH:mm[:ss] or ISO
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?(?:.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
      text,
    );
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const hh = Number(match[4]);
    const mm = Number(match[5]);
    const ss = Number(match[6] ?? 0);
    const tz = match[7];
    let epochMs: number;
    if (tz === 'Z') {
      epochMs = Date.UTC(y, m - 1, d, hh, mm, ss);
    } else if (tz && /^[+-]/.test(tz)) {
      const sign = tz.startsWith('-') ? -1 : 1;
      const digits = tz.replace(/[+-]/, '').replace(':', '');
      const oh = Number(digits.slice(0, 2) || '0');
      const om = Number(digits.slice(2, 4) || '0');
      epochMs = Date.UTC(y, m - 1, d, hh, mm, ss) - sign * (oh * 3600 + om * 60) * 1000;
    } else {
      epochMs = Date.UTC(y, m - 1, d, hh, mm, ss) - offsetHours * 3_600_000;
    }
    return { ok: true, iso: new Date(epochMs).toISOString(), epochMs };
  }

  // YYYY/MM/DD HH:mm
  const slash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (slash) {
    const y = Number(slash[1]);
    const m = Number(slash[2]);
    const d = Number(slash[3]);
    const hh = Number(slash[4]);
    const mm = Number(slash[5]);
    const ss = Number(slash[6] ?? 0);
    const epochMs = Date.UTC(y, m - 1, d, hh, mm, ss) - offsetHours * 3_600_000;
    return { ok: true, iso: new Date(epochMs).toISOString(), epochMs };
  }

  return { ok: false, reason: `Unrecognized datetime: ${text}` };
}

function timezoneOffsetHours(timezone: string): number {
  if (timezone === 'UTC' || timezone === 'Z' || timezone === 'Etc/UTC') return 0;
  if (timezone === 'Asia/Shanghai' || timezone === 'CST' || timezone === 'UTC+8') return 8;
  const match = /^UTC([+-])(\d{1,2})$/i.exec(timezone);
  if (match) {
    return (match[1] === '-' ? -1 : 1) * Number(match[2]);
  }
  return 0;
}

export function calculateIntervalDurationMinutes(
  startIso: string,
  endIso: string,
): number | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end < start) return null;
  return Math.round((end - start) / 60_000);
}

export type TimeInterval = {
  startMs: number;
  endMs: number;
  meta?: Record<string, unknown>;
};

export function detectIntervalOverlap(intervals: TimeInterval[]): Array<{
  aIndex: number;
  bIndex: number;
}> {
  const overlaps: Array<{ aIndex: number; bIndex: number }> = [];
  for (let i = 0; i < intervals.length; i += 1) {
    for (let j = i + 1; j < intervals.length; j += 1) {
      const a = intervals[i]!;
      const b = intervals[j]!;
      if (a.startMs < b.endMs && b.startMs < a.endMs) {
        overlaps.push({ aIndex: i, bIndex: j });
      }
    }
  }
  return overlaps;
}

export function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: TimeInterval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (current.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, current.endMs);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

export function totalIntervalMinutes(intervals: TimeInterval[]): number {
  return intervals.reduce((sum, item) => sum + Math.max(0, item.endMs - item.startMs), 0) / 60_000;
}

export function toYmdFromIso(iso: string): string {
  const dt = new Date(iso);
  return formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
