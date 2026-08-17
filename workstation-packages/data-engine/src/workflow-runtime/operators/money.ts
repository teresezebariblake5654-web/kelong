import Decimal from 'decimal.js';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type MoneyRoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP';

const ROUNDING_MAP: Record<MoneyRoundingMode, Decimal.Rounding> = {
  HALF_UP: Decimal.ROUND_HALF_UP,
  HALF_EVEN: Decimal.ROUND_HALF_EVEN,
  DOWN: Decimal.ROUND_DOWN,
  UP: Decimal.ROUND_UP,
};

export function toDecimal(value: unknown, fallback = '0'): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Decimal(value);
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      return new Decimal(value.trim().replace(/,/g, ''));
    } catch {
      return new Decimal(fallback);
    }
  }
  if (value === null || value === undefined || value === '') return new Decimal(fallback);
  try {
    return new Decimal(String(value));
  } catch {
    return new Decimal(fallback);
  }
}

export function moneyAdd(...values: unknown[]): Decimal {
  return values.reduce<Decimal>((acc, item) => acc.plus(toDecimal(item)), new Decimal(0));
}

export function moneySub(left: unknown, right: unknown): Decimal {
  return toDecimal(left).minus(toDecimal(right));
}

export function moneyMul(...values: unknown[]): Decimal {
  return values.reduce<Decimal>((acc, item) => acc.times(toDecimal(item)), new Decimal(1));
}

export function moneyDiv(left: unknown, right: unknown): Decimal {
  const divisor = toDecimal(right);
  if (divisor.isZero()) return new Decimal(0);
  return toDecimal(left).div(divisor);
}

export function moneyRound(
  value: unknown,
  scale = 2,
  mode: MoneyRoundingMode = 'HALF_UP',
): Decimal {
  return toDecimal(value).toDecimalPlaces(scale, ROUNDING_MAP[mode] ?? Decimal.ROUND_HALF_UP);
}

export function moneyToFixed(
  value: unknown,
  scale = 2,
  mode: MoneyRoundingMode = 'HALF_UP',
): string {
  return moneyRound(value, scale, mode).toFixed(scale);
}

export function moneyClamp(value: unknown, min: unknown, max: unknown): Decimal {
  let result = toDecimal(value);
  const minDec = toDecimal(min);
  const maxDec = toDecimal(max);
  if (result.lt(minDec)) result = minDec;
  if (result.gt(maxDec)) result = maxDec;
  return result;
}

export { Decimal };
