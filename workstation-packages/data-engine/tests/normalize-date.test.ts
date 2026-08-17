import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  excelSerialToYmd,
  normalizeDate,
} from '../src/index.js';

describe('normalizeDate', () => {
  it('parses unambiguous string formats and Date/ISO', () => {
    expect(normalizeDate('2026-07-22')).toEqual({ ok: true, value: '2026-07-22' });
    expect(normalizeDate('2026/7/22')).toEqual({ ok: true, value: '2026-07-22' });
    expect(normalizeDate('2026年07月22日')).toEqual({ ok: true, value: '2026-07-22' });
    expect(normalizeDate('2026-07-22T15:30:00Z')).toEqual({ ok: true, value: '2026-07-22' });
    expect(normalizeDate(new Date(Date.UTC(2026, 6, 22, 12, 0, 0)))).toEqual({
      ok: true,
      value: '2026-07-22',
    });
  });

  it('supports Excel 1900 and 1904 serials', () => {
    const target = Date.UTC(2026, 6, 22);
    const serial1900 = Math.round((target - Date.UTC(1899, 11, 30)) / 86_400_000);
    const serial1904 = Math.round((target - Date.UTC(1904, 0, 1)) / 86_400_000);
    expect(excelSerialToYmd(serial1900, '1900')).toEqual({ ok: true, value: '2026-07-22' });
    expect(excelSerialToYmd(serial1904, '1904')).toEqual({ ok: true, value: '2026-07-22' });
    expect(normalizeDate(serial1900, { excelDateSystem: '1900' }).ok).toBe(true);
    expect(normalizeDate(serial1904, { excelDateSystem: '1904' })).toEqual({
      ok: true,
      value: '2026-07-22',
    });
  });

  it('rejects ambiguous and invalid dates', () => {
    expect(normalizeDate('07/08/2026').ok).toBe(false);
    expect(normalizeDate('08/07/2026').ok).toBe(false);
    expect(normalizeDate('not-a-date').ok).toBe(false);
    expect(normalizeDate('').ok).toBe(false);
  });

  it('keeps calendar-day math timezone stable', () => {
    expect(daysBetween('2026-07-22', '2026-07-28')).toBe(6);
    expect(daysBetween('2026-07-22', '2026-07-20')).toBe(-2);
  });
});
