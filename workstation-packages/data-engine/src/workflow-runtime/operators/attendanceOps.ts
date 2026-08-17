import type { DataRow } from '../../types.js';
import { asText } from './fieldUtils.js';
import { normalizeDateTime } from './normalizeDateTime.js';

export type AttendanceRules = {
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
  missingPunchRule: 'ABSENT' | 'EXCEPTION' | 'IGNORE_ONCE';
  overtimeMinimumMinutes: number;
  maxWorkedMinutes: number;
  breakMinutesDefault: number;
};

export function parseClockToMinutes(value: unknown): number | null {
  const text = asText(value);
  if (!text) return null;
  const hm = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const dt = normalizeDateTime(text);
  if (dt.ok) {
    const d = new Date(dt.epochMs);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
  // datetime with space — take time part
  const timePart = text.includes(' ') ? text.split(/\s+/).pop()! : text;
  const hm2 = timePart.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hm2) return Number(hm2[1]) * 60 + Number(hm2[2]);
  return null;
}

export function minutesBetween(startMin: number, endMin: number, crossDay: boolean): number {
  if (!crossDay) return Math.max(endMin - startMin, 0);
  if (endMin >= startMin) return endMin - startMin;
  return endMin + 24 * 60 - startMin;
}

export function isCrossDayShift(shiftStart: unknown, shiftEnd: unknown): boolean {
  const start = parseClockToMinutes(shiftStart);
  const end = parseClockToMinutes(shiftEnd);
  if (start === null || end === null) return false;
  return end < start;
}

export function pairPunchesForShift(input: {
  punches: Array<{ punchTime: unknown; raw?: DataRow }>;
  shiftStart: unknown;
  shiftEnd: unknown;
}): {
  actualIn: unknown | null;
  actualOut: unknown | null;
  duplicatePunch: boolean;
  unpairedCrossDay: boolean;
} {
  const crossDay = isCrossDayShift(input.shiftStart, input.shiftEnd);
  const sorted = [...input.punches].sort((a, b) =>
    asText(a.punchTime).localeCompare(asText(b.punchTime)),
  );
  const times = sorted.map((p) => asText(p.punchTime));
  const unique = new Set(times);
  const duplicatePunch = unique.size < times.length;

  if (sorted.length === 0) {
    return { actualIn: null, actualOut: null, duplicatePunch, unpairedCrossDay: false };
  }
  if (sorted.length === 1) {
    return {
      actualIn: sorted[0]!.punchTime,
      actualOut: null,
      duplicatePunch,
      unpairedCrossDay: crossDay,
    };
  }
  return {
    actualIn: sorted[0]!.punchTime,
    actualOut: sorted[sorted.length - 1]!.punchTime,
    duplicatePunch,
    unpairedCrossDay: false,
  };
}

export function calcLateMinutes(input: {
  actualIn: unknown;
  shiftStart: unknown;
  graceMinutes: number;
}): number {
  const actual = parseClockToMinutes(input.actualIn);
  const start = parseClockToMinutes(input.shiftStart);
  if (actual === null || start === null) return 0;
  return Math.max(actual - start - input.graceMinutes, 0);
}

export function calcEarlyLeaveMinutes(input: {
  actualOut: unknown;
  shiftStart: unknown;
  shiftEnd: unknown;
  graceMinutes: number;
  crossDay: boolean;
}): number {
  const actual = parseClockToMinutes(input.actualOut);
  const end = parseClockToMinutes(input.shiftEnd);
  const start = parseClockToMinutes(input.shiftStart);
  if (actual === null || end === null || start === null) return 0;
  if (!input.crossDay) {
    return Math.max(end - actual - input.graceMinutes, 0);
  }
  const endAbs = end < start ? end + 1440 : end;
  const actualAbs = actual < start ? actual + 1440 : actual;
  return Math.max(endAbs - actualAbs - input.graceMinutes, 0);
}

export function calcWorkedMinutes(input: {
  actualIn: unknown;
  actualOut: unknown;
  breakMinutes: number;
  crossDay: boolean;
}): number {
  const start = parseClockToMinutes(input.actualIn);
  const end = parseClockToMinutes(input.actualOut);
  if (start === null || end === null) return 0;
  const span = minutesBetween(start, end, input.crossDay || end < start);
  return Math.max(span - input.breakMinutes, 0);
}

export function classifyAttendanceException(input: {
  hasSchedule: boolean;
  actualIn: unknown | null;
  actualOut: unknown | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  workedMinutes: number;
  duplicatePunch: boolean;
  unpairedCrossDay: boolean;
  leaveConflict: boolean;
  punchedAfterTermination: boolean;
  rules: AttendanceRules;
}): string[] {
  const codes: string[] = [];
  if (!input.hasSchedule) codes.push('MISSING_SCHEDULE');
  if (input.hasSchedule && !input.actualIn) codes.push('MISSING_IN_PUNCH');
  if (input.hasSchedule && input.actualIn && !input.actualOut) codes.push('MISSING_OUT_PUNCH');
  if (input.duplicatePunch) codes.push('DUPLICATE_PUNCH');
  if (input.unpairedCrossDay) codes.push('CROSS_DAY_UNPAIRED');
  if (input.leaveConflict) codes.push('LEAVE_ATTENDANCE_CONFLICT');
  if (input.punchedAfterTermination) codes.push('PUNCH_AFTER_TERMINATION');
  if (input.workedMinutes > input.rules.maxWorkedMinutes) codes.push('ABNORMAL_LONG_HOURS');
  if (input.lateMinutes > 0) codes.push('LATE');
  if (input.earlyLeaveMinutes > 0) codes.push('EARLY_LEAVE');
  if (
    input.hasSchedule &&
    !input.actualIn &&
    !input.actualOut &&
    input.rules.missingPunchRule === 'ABSENT'
  ) {
    codes.push('ABSENT');
  }
  return codes;
}
