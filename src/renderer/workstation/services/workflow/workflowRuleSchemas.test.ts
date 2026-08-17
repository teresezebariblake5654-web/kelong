import { describe, expect, it } from 'vitest';
import {
  buildCompanyRulePatch,
  canonicalizeRulesDraft,
  encodeGroupByForUi,
  formatRuleDisplayValue,
  formatRuleInputText,
  isValidDecimalString,
  localizeRulesForDisplay,
  materializeRulesForRun,
  parseRuleInputText,
  readEditableRuleValue,
  ruleFieldsForWorkflow,
  ruleKeyLabel,
  stripSafetyLockRules,
  validateDecimalString,
  validateWorkflowRules,
  writeRuleField,
} from './workflowRuleSchemas';

describe('workflowRuleSchemas', () => {
  it('validates decimal-string amounts without float stepping', () => {
    expect(isValidDecimalString('1.50')).toBe(true);
    expect(isValidDecimalString('0.1')).toBe(true);
    expect(isValidDecimalString('0')).toBe(true);
    expect(isValidDecimalString('-10.50')).toBe(true);
    expect(isValidDecimalString('abc')).toBe(false);
    expect(isValidDecimalString('')).toBe(false);
    expect(isValidDecimalString('1.0.0')).toBe(false);
    expect(isValidDecimalString('NaN')).toBe(false);
    expect(validateDecimalString('0.01')).toBe(true);

    const ok = validateWorkflowRules('HR-PAYROLL-001', {
      standardPayableDays: 21.75,
      overtimeMultiplier: 1.5,
      lateDeductionPerMinute: '1.00',
      roundingScale: 2,
    });
    expect(ok).toEqual({ ok: true });

    const bad = validateWorkflowRules('HR-PAYROLL-001', {
      standardPayableDays: 21.75,
      overtimeMultiplier: 1.5,
      lateDeductionPerMinute: '1.0.0',
      roundingScale: 2,
    });
    expect(bad.ok).toBe(false);
  });

  it('keeps number draft editable and syncs aliases on write', () => {
    expect(parseRuleInputText('1.', { key: 'overtimeMultiplier', label: '加班倍率', type: 'number' })).toBe(
      '1.',
    );
    expect(parseRuleInputText('1.5', { key: 'overtimeMultiplier', label: '加班倍率', type: 'number' })).toBe(
      1.5,
    );
    expect(
      parseRuleInputText('5', {
        key: 'payrollChangeWarningRate',
        label: '净工资环比预警比例',
        type: 'number',
        percent: true,
        min: 0,
        max: 1,
      }),
    ).toBe(0.05);
    expect(
      formatRuleInputText(0.05, {
        key: 'payrollChangeWarningRate',
        label: '净工资环比预警比例',
        type: 'number',
        percent: true,
      }),
    ).toBe('5');

    const cleared = writeRuleField(
      { overtimeMultiplier: 1.5, 'payroll.overtimeMultiplier': 1.5 },
      'overtimeMultiplier',
      '',
    );
    expect(cleared.overtimeMultiplier).toBe('');
    expect(cleared['payroll.overtimeMultiplier']).toBe('');
    expect(readEditableRuleValue(cleared, 'overtimeMultiplier')).toBe('');
  });

  it('aligns social / performance schema keys with engine defaults', () => {
    const socialKeys = ruleFieldsForWorkflow('HR-SOCIAL-INSURANCE-005').map((f) => f.key);
    expect(socialKeys).toEqual(expect.arrayContaining(['minBase', 'maxBase', 'minFundBase', 'maxFundBase']));
    expect(socialKeys).not.toContain('insuranceMinBase');

    const draft = canonicalizeRulesDraft(
      'HR-PERFORMANCE-DISTRIBUTION-007',
      {
        groupBy: ['department', 'level'],
        ratingBands: [{ rating: 'A', minScore: 90, maxScore: 100 }],
        minimumGroupSize: 8,
        outlierMethod: 'IQR',
      },
      {},
    );
    expect(draft.groupBy).toBe('department,level');
    expect(encodeGroupByForUi(['department', 'level'])).toBe('department,level');
    const materialized = materializeRulesForRun('HR-PERFORMANCE-DISTRIBUTION-007', draft);
    expect(materialized.groupBy).toEqual(['department', 'level']);
    expect(Array.isArray(materialized.ratingBands)).toBe(true);
  });

  it('saves only company overrides relative to defaults', () => {
    const defaults = {
      standardPayableDays: 21.75,
      overtimeMultiplier: 1.5,
      lateDeductionPerMinute: '1.00',
      roundingScale: 2,
      negativeNetPayBlocked: true,
    };
    const draft = {
      ...defaults,
      overtimeMultiplier: 2,
      'payroll.overtimeMultiplier': 2,
    };
    const patch = buildCompanyRulePatch('HR-PAYROLL-001', draft, defaults);
    expect(patch.overtimeMultiplier).toBe(2);
    expect(patch['payroll.overtimeMultiplier']).toBe(2);
    expect(patch.standardPayableDays).toBeUndefined();
  });

  it('validates finance decimal rules', () => {
    expect(ruleFieldsForWorkflow('FIN-EXPENSE-CLEAN-001').some((f) => f.key === 'amountTolerance')).toBe(
      true,
    );
    const ok = validateWorkflowRules('FIN-RECONCILIATION-002', {
      dateToleranceDays: 3,
      amountTolerance: '0.01',
    });
    expect(ok).toEqual({ ok: true });
    const bad = validateWorkflowRules('FIN-ARAP-003', {
      materialityAmount: '10.0.0',
      longOverdueDays: 180,
    });
    expect(bad.ok).toBe(false);
  });

  it('requires social policy version', () => {
    expect(ruleFieldsForWorkflow('HR-SOCIAL-INSURANCE-005').some((f) => f.key === 'policyVersion')).toBe(
      true,
    );
    const missing = validateWorkflowRules('HR-SOCIAL-INSURANCE-005', { region: 'SH' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.message).toMatch(/政策版本|社保政策版本/);
    }
    const present = validateWorkflowRules('HR-SOCIAL-INSURANCE-005', {
      region: 'SH',
      policyVersion: '2026-Q1',
    });
    expect(present).toEqual({ ok: true });
  });

  it('exposes Chinese labels for production / logistics / admin rules', () => {
    expect(ruleFieldsForWorkflow('PROD-MATERIAL-DAILY-001')[0]?.label).toBe('数量容差');
    expect(ruleFieldsForWorkflow('LOG-INVENTORY-COUNT-001').some((f) => f.label === '数量容差')).toBe(
      true,
    );
    expect(ruleFieldsForWorkflow('ADMIN-ASSET-INVENTORY-001')[0]?.label).toMatch(/匹配/);
    expect(ruleKeyLabel('materialDaily.toleranceQty')).toBe('数量容差');
    expect(formatRuleDisplayValue(true)).toBe('是');
    expect(formatRuleDisplayValue('DUE_DATE')).toBe('按交期');
    expect(localizeRulesForDisplay({ matchRule: 'SKU_WAREHOUSE', qtyTolerance: '0.01' })).toEqual({
      匹配规则: 'SKU + 仓库',
      数量容差: '0.01',
    });
  });

  it('hides automatic execution controls from company rules', () => {
    for (const workflowId of [
      'ECOM-REFUND-002',
      'PROD-MATERIAL-DAILY-001',
      'HR-PAYROLL-001',
      'FIN-EXPENSE-CLEAN-001',
      'FIN-OPERATING-SUMMARY-005',
      'LOG-INVENTORY-COUNT-001',
      'ADMIN-CONTRACT-EXPIRY-004',
    ]) {
      expect(
        ruleFieldsForWorkflow(workflowId).some(
          (field) =>
            field.key.startsWith('safety.') ||
            (/^auto[A-Z]/.test(field.key) && field.key !== 'autoRenewNoticeDays'),
        ),
      ).toBe(false);
    }
    expect(
      ruleFieldsForWorkflow('ADMIN-CONTRACT-EXPIRY-004').find(
        (field) => field.key === 'autoRenewNoticeDays',
      )?.label,
    ).toBe('续约提醒天数');
    expect(stripSafetyLockRules({ amountTolerance: '0.01', 'safety.autoRefund': false })).toEqual({
      amountTolerance: '0.01',
    });
    expect(
      localizeRulesForDisplay({
        amountTolerance: '0.01',
        autoRefund: false,
        'safety.autoBook': false,
        autoRenewNoticeDays: 60,
      }),
    ).toEqual({
      金额容差: '0.01',
      续约提醒天数: '60',
    });
  });
  it('aligns employee match and operating period enums with engine', () => {
    const match = ruleFieldsForWorkflow('HR-EMPLOYEE-FILE-003').find((f) => f.key === 'matchRule');
    expect(match?.options?.map((o) => o.value)).toEqual([
      'EMPLOYEE_ID',
      'ID_NUMBER',
      'PHONE',
      'NAME_HIRE_DATE',
    ]);
    const period = ruleFieldsForWorkflow('FIN-OPERATING-SUMMARY-005').find((f) => f.key === 'periodMode');
    expect(period?.options?.map((o) => o.value)).toEqual(['MONTH', 'WEEK']);
  });
});



