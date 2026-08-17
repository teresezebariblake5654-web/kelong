import { describe, expect, it } from 'vitest';
import {
  LOGISTICS_WORKFLOW_IDS,
  logisticsDisclaimer,
  logisticsNeedsReview,
  listLogisticsWorkflows,
  presentWorkflowResult,
  type DesktopExecuteResult,
} from '@workstation/services/workflow';

function fakeResult(partial: Partial<DesktopExecuteResult>): DesktopExecuteResult {
  return {
    runId: 'r1',
    workflowId: 'LOG-INVENTORY-COUNT-001',
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

describe('logistics desktop catalog + presenter', () => {
  it('exposes five logistics workflows with goals and disclaimers', () => {
    const list = listLogisticsWorkflows();
    expect(list).toHaveLength(5);
    expect(list.map((w) => w.id)).toEqual([...LOGISTICS_WORKFLOW_IDS]);
    for (const workflow of list) {
      expect(workflow.businessGoal.length).toBeGreaterThan(0);
      expect(workflow.category).toBe('logistics');
      expect(logisticsDisclaimer(workflow.id)).toBeTruthy();
    }
  });

  it('presents inventory / inout / track / alert / transfer metrics', () => {
    const inventory = presentWorkflowResult(
      'LOG-INVENTORY-COUNT-001',
      fakeResult({
        metrics: { lineCount: 3, skuCount: 2, shortageCount: 1, overageCount: 0 },
      }),
    );
    expect(inventory.some((c) => c.label === '盘点行数' && c.value === '3')).toBe(true);

    const alert = presentWorkflowResult(
      'LOG-STOCK-ALERT-004',
      fakeResult({
        workflowId: 'LOG-STOCK-ALERT-004',
        metrics: { skuCount: 4, lowStockCount: 1, overstockCount: 1 },
        status: 'NEEDS_REVIEW',
        exceptions: [{ code: 'LOW_STOCK', severity: 'WARNING', count: 1 }],
      }),
    );
    expect(alert.some((c) => c.label === '低库存' && c.value === '1')).toBe(true);
    expect(
      logisticsNeedsReview(
        fakeResult({
          status: 'NEEDS_REVIEW',
          exceptions: [{ code: 'SHORTAGE', severity: 'WARNING', count: 1 }],
        }),
      ),
    ).toBe(true);

    const transfer = presentWorkflowResult(
      'LOG-TRANSFER-CLEAN-005',
      fakeResult({
        workflowId: 'LOG-TRANSFER-CLEAN-005',
        metrics: { transferCount: 2, overdueCount: 1, pendingReceiptCount: 1 },
      }),
    );
    expect(transfer.some((c) => c.label === '在途超时' && c.value === '1')).toBe(true);
  });
});
