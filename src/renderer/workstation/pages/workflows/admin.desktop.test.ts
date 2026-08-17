import { describe, expect, it } from 'vitest';
import {
  ADMIN_WORKFLOW_IDS,
  adminDisclaimer,
  adminNeedsReview,
  listAdminWorkflows,
  presentWorkflowResult,
  type DesktopExecuteResult,
} from '@workstation/services/workflow';

function fakeResult(partial: Partial<DesktopExecuteResult>): DesktopExecuteResult {
  return {
    runId: 'r1',
    workflowId: 'ADMIN-ASSET-INVENTORY-001',
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

describe('admin desktop catalog + presenter', () => {
  it('exposes four admin workflows with goals and disclaimers', () => {
    const list = listAdminWorkflows();
    expect(list).toHaveLength(4);
    expect(list.map((w) => w.id)).toEqual([...ADMIN_WORKFLOW_IDS]);
    for (const workflow of list) {
      expect(workflow.businessGoal.length).toBeGreaterThan(0);
      expect(workflow.category).toBe('admin');
      expect(adminDisclaimer(workflow.id)).toBeTruthy();
    }
  });

  it('presents asset / expense / room / contract metrics', () => {
    const asset = presentWorkflowResult(
      'ADMIN-ASSET-INVENTORY-001',
      fakeResult({
        metrics: {
          registerCount: 5,
          physicalCount: 4,
          shortageCount: 1,
          surplusCount: 0,
          maintenanceDueCount: 1,
        },
      }),
    );
    expect(asset.some((c) => c.label === '台账数量' && c.value === '5')).toBe(true);

    const expense = presentWorkflowResult(
      'ADMIN-EXPENSE-ANALYSIS-002',
      fakeResult({
        workflowId: 'ADMIN-EXPENSE-ANALYSIS-002',
        metrics: {
          expenseLineCount: 8,
          totalAmount: '1200.00',
          controlTotal: '1200.00',
          abnormalGrowthCount: 2,
        },
        status: 'NEEDS_REVIEW',
        exceptions: [{ code: 'ABNORMAL_GROWTH', severity: 'WARNING', count: 2 }],
      }),
    );
    expect(expense.some((c) => c.label === '费用笔数' && c.value === '8')).toBe(true);
    expect(
      adminNeedsReview(
        fakeResult({
          status: 'NEEDS_REVIEW',
          exceptions: [{ code: 'EXPIRING_SOON', severity: 'WARNING', count: 1 }],
        }),
      ),
    ).toBe(true);

    const contract = presentWorkflowResult(
      'ADMIN-CONTRACT-EXPIRY-004',
      fakeResult({
        workflowId: 'ADMIN-CONTRACT-EXPIRY-004',
        metrics: {
          contractCount: 3,
          expiringCount: 1,
          expiredCount: 1,
          overdueMilestoneCount: 0,
        },
      }),
    );
    expect(contract.some((c) => c.label === '即将到期' && c.value === '1')).toBe(true);
  });
});
