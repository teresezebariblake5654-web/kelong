import type { MoneyRoundingMode } from '../operators/money.js';
import { moneyMul, moneyRound, moneyToFixed, toDecimal } from '../operators/money.js';

export type PayrollRules = {
  standardPayableDays: number;
  overtimeMultiplier: number;
  lateDeductionPerMinute: string;
  absenceDeductionMode: 'DAILY_SALARY' | 'FIXED';
  absenceFixedAmount: string;
  roundingScale: number;
  roundingMode: MoneyRoundingMode;
  negativeNetPayBlocked: boolean;
  payrollChangeWarningRate: number;
};

export type PayrollPolicyContext = {
  region?: string;
  payMonth: string;
  rules: PayrollRules;
};

/**
 * Configurable payroll policy. This round only ships a default config adapter —
 * no regional tax network calls.
 */
export interface PayrollPolicyAdapter {
  getRules(ctx: PayrollPolicyContext): PayrollRules;
  calcOvertimePay(input: {
    overtimeHours: unknown;
    hourlySalary: unknown;
    overtimeBase: unknown;
    rules: PayrollRules;
  }): string;
  calcLateDeduction(input: { lateMinutes: unknown; rules: PayrollRules }): string;
  calcAbsenceDeduction(input: {
    absenceDays: unknown;
    dailySalary: unknown;
    rules: PayrollRules;
  }): string;
}

export class DefaultPayrollPolicyAdapter implements PayrollPolicyAdapter {
  getRules(ctx: PayrollPolicyContext): PayrollRules {
    return { ...ctx.rules };
  }

  calcOvertimePay(input: {
    overtimeHours: unknown;
    hourlySalary: unknown;
    overtimeBase: unknown;
    rules: PayrollRules;
  }): string {
    const hourly = toDecimal(input.hourlySalary);
    const base =
      hourly.isZero() && input.overtimeBase !== undefined && input.overtimeBase !== ''
        ? toDecimal(input.overtimeBase)
        : hourly;
    const pay = moneyMul(input.overtimeHours, base, input.rules.overtimeMultiplier);
    return moneyToFixed(pay, input.rules.roundingScale, input.rules.roundingMode);
  }

  calcLateDeduction(input: { lateMinutes: unknown; rules: PayrollRules }): string {
    const pay = moneyMul(input.lateMinutes, input.rules.lateDeductionPerMinute);
    return moneyToFixed(pay, input.rules.roundingScale, input.rules.roundingMode);
  }

  calcAbsenceDeduction(input: {
    absenceDays: unknown;
    dailySalary: unknown;
    rules: PayrollRules;
  }): string {
    const amount =
      input.rules.absenceDeductionMode === 'FIXED'
        ? moneyMul(input.absenceDays, input.rules.absenceFixedAmount)
        : moneyMul(input.absenceDays, input.dailySalary);
    return moneyToFixed(amount, input.rules.roundingScale, input.rules.roundingMode);
  }
}

export function createDefaultPayrollPolicyAdapter(): PayrollPolicyAdapter {
  return new DefaultPayrollPolicyAdapter();
}

export function roundPayrollAmount(value: unknown, rules: PayrollRules): string {
  return moneyToFixed(moneyRound(value, rules.roundingScale, rules.roundingMode), rules.roundingScale, rules.roundingMode);
}
