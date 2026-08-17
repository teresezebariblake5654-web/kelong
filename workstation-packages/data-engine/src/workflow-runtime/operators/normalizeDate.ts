export type ExcelDateSystem = '1900' | '1904';

export type NormalizeDateResult =
  | { ok: true; value: string }
  | { ok: false; code: 'INVALID_DATE'; reason: string };

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YMD_SLASH_RE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
const YMD_CN_RE = /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日$/;
const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/;
const AMBIGUOUS_SLASH_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function isValidYmdParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const utc = Date.UTC(year, month - 1, day);
  const dt = new Date(utc);
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function parseYmd(value: string): { year: number; month: number; day: number } | null {
  const match = YMD_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidYmdParts(year, month, day)) return null;
  return { year, month, day };
}

/**
 * Convert Excel serial to YYYY-MM-DD using UTC calendar math (timezone-stable).
 * 1900 system uses Excel's legacy epoch (1899-12-30) including the 1900 leap-year bug behavior.
 * 1904 system uses 1904-01-01 epoch.
 */
export function excelSerialToYmd(
  serial: number,
  dateSystem: ExcelDateSystem = '1900',
): NormalizeDateResult {
  if (!Number.isFinite(serial)) {
    return { ok: false, code: 'INVALID_DATE', reason: 'Excel serial is not finite' };
  }
  const whole = Math.floor(serial);
  const epoch =
    dateSystem === '1904' ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const utc = epoch + whole * 86_400_000;
  const dt = new Date(utc);
  if (Number.isNaN(dt.getTime())) {
    return { ok: false, code: 'INVALID_DATE', reason: 'Excel serial out of range' };
  }
  return {
    ok: true,
    value: formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()),
  };
}

export function normalizeDate(
  input: unknown,
  options?: {
    excelDateSystem?: ExcelDateSystem;
    /** When true, numeric values are treated as Excel serials. Default true. */
    acceptExcelSerial?: boolean;
  },
): NormalizeDateResult {
  const excelDateSystem = options?.excelDateSystem ?? '1900';
  const acceptExcelSerial = options?.acceptExcelSerial ?? true;

  if (input === null || input === undefined || input === '') {
    return { ok: false, code: 'INVALID_DATE', reason: 'Empty date' };
  }

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      return { ok: false, code: 'INVALID_DATE', reason: 'Invalid Date object' };
    }
    // Use UTC components so local TZ cannot shift the calendar day for stored instants.
    return {
      ok: true,
      value: formatYmd(input.getUTCFullYear(), input.getUTCMonth() + 1, input.getUTCDate()),
    };
  }

  if (typeof input === 'number') {
    if (!acceptExcelSerial) {
      return { ok: false, code: 'INVALID_DATE', reason: 'Numeric date not allowed' };
    }
    return excelSerialToYmd(input, excelDateSystem);
  }

  const text = String(input).trim();
  if (!text) return { ok: false, code: 'INVALID_DATE', reason: 'Empty date' };

  // Unambiguous formats first.
  let match = YMD_RE.exec(text);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidYmdParts(year, month, day)) {
      return { ok: false, code: 'INVALID_DATE', reason: 'Invalid YYYY-MM-DD' };
    }
    return { ok: true, value: formatYmd(year, month, day) };
  }

  match = YMD_SLASH_RE.exec(text);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidYmdParts(year, month, day)) {
      return { ok: false, code: 'INVALID_DATE', reason: 'Invalid YYYY/MM/DD' };
    }
    return { ok: true, value: formatYmd(year, month, day) };
  }

  match = YMD_CN_RE.exec(text);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidYmdParts(year, month, day)) {
      return { ok: false, code: 'INVALID_DATE', reason: 'Invalid Chinese date' };
    }
    return { ok: true, value: formatYmd(year, month, day) };
  }

  match = ISO_RE.exec(text);
  if (match && text.includes('T')) {
    // ISO datetime: take the calendar date from the string prefix (timezone-stable).
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidYmdParts(year, month, day)) {
      return { ok: false, code: 'INVALID_DATE', reason: 'Invalid ISO date' };
    }
    return { ok: true, value: formatYmd(year, month, day) };
  }

  // Ambiguous day/month slash forms — never guess.
  match = AMBIGUOUS_SLASH_RE.exec(text);
  if (match) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    if (a <= 12 && b <= 12) {
      return {
        ok: false,
        code: 'INVALID_DATE',
        reason: 'Ambiguous day/month date (e.g. 07/08/2026)',
      };
    }
    // If one part > 12 we could disambiguate, but spec says reject 07/08 and 08/07 style.
    // Still reject all D/M/Y and M/D/Y to avoid locale guessing.
    return {
      ok: false,
      code: 'INVALID_DATE',
      reason: 'Ambiguous or unsupported slash date format',
    };
  }

  // Numeric string Excel serial
  if (acceptExcelSerial && /^[0-9]+(\.[0-9]+)?$/.test(text)) {
    return excelSerialToYmd(Number(text), excelDateSystem);
  }

  return { ok: false, code: 'INVALID_DATE', reason: `Unrecognized date: ${text}` };
}

export function requireYmd(
  input: unknown,
  options?: { excelDateSystem?: ExcelDateSystem },
): string | null {
  const result = normalizeDate(input, options);
  return result.ok ? result.value : null;
}
