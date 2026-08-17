import { describe, expect, it } from 'vitest';
import {
  ECOMMERCE_WORKFLOW_IDS,
  ecommerceDisclaimer,
  ecommerceNeedsReview,
  listEcommerceWorkflows,
  presentWorkflowResult,
  type DesktopExecuteResult,
} from '@workstation/services/workflow';

function fakeResult(partial: Partial<DesktopExecuteResult>): DesktopExecuteResult {
  return {
    runId: 'r1',
    workflowId: 'ECOM-ORDER-CLEAN-001',
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

describe('ecommerce desktop catalog + presenter', () => {
  it('exposes five ecommerce workflows with goals and disclaimers', () => {
    const list = listEcommerceWorkflows();
    expect(list).toHaveLength(5);
    expect(list.map((w) => w.id)).toEqual([...ECOMMERCE_WORKFLOW_IDS]);
    for (const workflow of list) {
      expect(workflow.businessGoal.length).toBeGreaterThan(0);
      expect(workflow.category).toBe('ecommerce');
      expect(ecommerceDisclaimer(workflow.id)).toBeTruthy();
    }
  });

  it('presents order / refund / product / live / sales metrics', () => {
    const order = presentWorkflowResult(
      'ECOM-ORDER-CLEAN-001',
      fakeResult({
        metrics: { orderCount: 2, orderLineCount: 3, readyCount: 1, duplicateCount: 1 },
      }),
    );
    expect(order.some((c) => c.label === '订单数' && c.value === '2')).toBe(true);

    const refund = presentWorkflowResult(
      'ECOM-REFUND-002',
      fakeResult({
        workflowId: 'ECOM-REFUND-002',
        metrics: { refundRowCount: 4, overRefundCount: 1, overdueCount: 1 },
        status: 'NEEDS_REVIEW',
        exceptions: [{ code: 'OVER_REFUND', severity: 'WARNING', count: 1 }],
      }),
    );
    expect(refund.some((c) => c.label === '退款笔数' && c.value === '4')).toBe(true);
    expect(
      ecommerceNeedsReview(
        fakeResult({
          status: 'NEEDS_REVIEW',
          exceptions: [{ code: 'OVERSELL', severity: 'WARNING', count: 1 }],
        }),
      ),
    ).toBe(true);

    const sales = presentWorkflowResult(
      'ECOM-SALES-SUMMARY-005',
      fakeResult({
        workflowId: 'ECOM-SALES-SUMMARY-005',
        metrics: {
          orderCount: 2,
          netSales: '100.00',
          grossSales: '120.00',
          refundAmount: '20.00',
          controlBalanced: true,
        },
      }),
    );
    expect(sales.some((c) => c.label === '控制是否平衡' && c.value === '平衡')).toBe(true);
  });
});
