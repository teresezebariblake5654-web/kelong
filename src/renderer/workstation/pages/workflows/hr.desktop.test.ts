import { describe, expect, it } from 'vitest';
import {
  HR_WORKFLOW_IDS,
  aiSummaryLooksSafe,
  hrDisclaimer,
  listHrWorkflows,
  presentWorkflowResult,
  socialPolicyMissing,
  workflowDisclaimer,
  type DesktopExecuteResult,
} from '@workstation/services/workflow';

function fakeResult(partial: Partial<DesktopExecuteResult>): DesktopExecuteResult {
  return {
    runId: 'r1',
    workflowId: 'HR-PAYROLL-001',
    workflowVersion: '1.0.0',
    status: 'COMPLETED',
    outputFiles: [],
    metrics: {},
    exceptions: [],
    effectiveRules: {},
    cloudUpload: false,
    executedAt: '2026-07-22T00:00:00.000Z',
    phase: '完成',
    ...partial,
  };
}

describe('hr desktop catalog + presenter', () => {
  it('exposes seven HR workflows with sensitive goals', () => {
    const list = listHrWorkflows();
    expect(list).toHaveLength(7);
    expect(list.map((w) => w.id)).toEqual([...HR_WORKFLOW_IDS]);
    for (const workflow of list) {
      expect(workflow.businessGoal.length).toBeGreaterThan(0);
      expect(workflow.category).toBe('hr');
      expect(hrDisclaimer(workflow.id)).toBeTruthy();
      expect(workflowDisclaimer(workflow.id)).toMatch(/不自动/);
    }
  });

  it('presents payroll metrics and guards social completion', () => {
    const cards = presentWorkflowResult(
      'HR-PAYROLL-001',
      fakeResult({
        metrics: {
          employeeCount: 2,
          readyToPayCount: 2,
          grossPayTotal: '1000.00',
          netPayTotal: '900.00',
          bankNetPayTotal: '900.00',
        },
      }),
    );
    expect(cards.some((c) => c.label === '银行发薪总额' && c.value === '900.00')).toBe(true);
    expect(cards.some((c) => c.label === '银行与实发是否一致' && c.value === '一致')).toBe(true);

    expect(socialPolicyMissing(fakeResult({ metrics: {} }))).toBe(true);
    expect(socialPolicyMissing(fakeResult({ metrics: { policyVersion: '2026-Q1' } }))).toBe(false);
    expect(aiSummaryLooksSafe({ rawRows: false, metrics: { employeeCount: 1 } })).toBe(true);
    expect(aiSummaryLooksSafe({ rawRows: true })).toBe(false);
  });
});
