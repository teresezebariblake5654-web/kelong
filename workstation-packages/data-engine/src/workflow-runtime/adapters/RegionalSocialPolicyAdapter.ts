import type { SocialInsuranceRules } from '../rules/RuleStore.js';
import { moneyClamp, moneyMul, moneyToFixed, toDecimal } from '../operators/money.js';

export type RegionalSocialPolicy = SocialInsuranceRules & {
  version: string;
};

/**
 * Config-file / in-memory regional social policy. No network calls.
 */
export interface RegionalSocialPolicyAdapter {
  getPolicy(input: {
    region?: string;
    month: string;
    rules: SocialInsuranceRules;
  }): RegionalSocialPolicy;
  expectedEmployeeInsurance(base: unknown, policy: RegionalSocialPolicy): string;
  expectedEmployeeFund(base: unknown, policy: RegionalSocialPolicy): string;
  expectedCompanyInsurance(base: unknown, policy: RegionalSocialPolicy): string;
  expectedCompanyFund(base: unknown, policy: RegionalSocialPolicy): string;
  shouldCoverMonth(input: {
    hireDate?: string;
    terminationDate?: string;
    employmentStatus?: string;
    month: string;
    policy: RegionalSocialPolicy;
  }): boolean;
}

function monthOf(ymd: string | undefined): string {
  if (!ymd) return '';
  return ymd.slice(0, 7);
}

export class InMemoryRegionalSocialPolicyAdapter implements RegionalSocialPolicyAdapter {
  getPolicy(input: {
    region?: string;
    month: string;
    rules: SocialInsuranceRules;
  }): RegionalSocialPolicy {
    return {
      ...input.rules,
      region: input.region ?? input.rules.region,
      version: input.rules.policyVersion,
    };
  }

  expectedEmployeeInsurance(base: unknown, policy: RegionalSocialPolicy): string {
    const clamped = moneyClamp(base, policy.minBase, policy.maxBase);
    return moneyToFixed(
      moneyMul(clamped, policy.employeeInsuranceRate),
      policy.roundingScale,
      policy.roundingMode,
    );
  }

  expectedEmployeeFund(base: unknown, policy: RegionalSocialPolicy): string {
    const clamped = moneyClamp(base, policy.minFundBase, policy.maxFundBase);
    return moneyToFixed(
      moneyMul(clamped, policy.employeeFundRate),
      policy.roundingScale,
      policy.roundingMode,
    );
  }

  expectedCompanyInsurance(base: unknown, policy: RegionalSocialPolicy): string {
    const clamped = moneyClamp(base, policy.minBase, policy.maxBase);
    return moneyToFixed(
      moneyMul(clamped, policy.companyInsuranceRate),
      policy.roundingScale,
      policy.roundingMode,
    );
  }

  expectedCompanyFund(base: unknown, policy: RegionalSocialPolicy): string {
    const clamped = moneyClamp(base, policy.minFundBase, policy.maxFundBase);
    return moneyToFixed(
      moneyMul(clamped, policy.companyFundRate),
      policy.roundingScale,
      policy.roundingMode,
    );
  }

  shouldCoverMonth(input: {
    hireDate?: string;
    terminationDate?: string;
    employmentStatus?: string;
    month: string;
    policy: RegionalSocialPolicy;
  }): boolean {
    const hireMonth = monthOf(input.hireDate);
    const termMonth = monthOf(input.terminationDate);
    const rule = input.policy.joinLeaveMonthRule;

    if (hireMonth) {
      if (rule === 'JOIN_NEXT_LEAVE_CURRENT' && input.month <= hireMonth) return false;
      if (rule !== 'JOIN_NEXT_LEAVE_CURRENT' && input.month < hireMonth) return false;
    }
    if (termMonth) {
      if (rule === 'JOIN_CURRENT_LEAVE_PREVIOUS' && input.month >= termMonth) return false;
      if (rule !== 'JOIN_CURRENT_LEAVE_PREVIOUS' && input.month > termMonth) return false;
    }
    const status = String(input.employmentStatus ?? '').toUpperCase();
    if ((status.includes('TERMINAT') || status.includes('离职')) && !termMonth) return false;
    return true;
  }
}

export function createRegionalSocialPolicyAdapter(): RegionalSocialPolicyAdapter {
  return new InMemoryRegionalSocialPolicyAdapter();
}

export function amountDiffExceeds(actual: unknown, expected: unknown, tolerance: unknown): boolean {
  return toDecimal(actual).minus(toDecimal(expected)).abs().gt(toDecimal(tolerance));
}
