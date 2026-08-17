import { describe, expect, it } from 'vitest';
import {
  FINANCE_WORKFLOW_IDS,
  aiSummaryLooksSafe,
  financeDisclaimer,
  financeNeedsReview,
  listFinanceWorkflows,
  presentWorkflowResult,
  type DesktopExecuteResult,
} from '@workstation/services/workflow';

function fakeResult(partial: Partial<DesktopExecuteResult>): DesktopExecuteResult {
  return {
    runId: 'r1',
    workflowId: 'FIN-EXPENSE-CLEAN-001',
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

describe('finance desktop catalog + presenter', () => {
  it('exposes five finance workflows with goals and disclaimers', () => {
    const list = listFinanceWorkflows();
    expect(list).toHaveLength(5);
    expect(list.map((w) => w.id)).toEqual([...FINANCE_WORKFLOW_IDS]);
    for (const workflow of list) {
      expect(workflow.businessGoal.length).toBeGreaterThan(0);
      expect(workflow.category).toBe('finance');
      expect(financeDisclaimer(workflow.id)).toBeTruthy();
    }
  });

  it('presents expense / recon / arap / invoice / operating metrics', () => {
    const expense = presentWorkflowResult(
      'FIN-EXPENSE-CLEAN-001',
      fakeResult({
        metrics: { expenseCount: 3, controlTotalAmount: '100.00', duplicateCount: 1 },
        exceptions: [{ code: 'OVER_LIMIT', severity: 'WARNING', count: 1 }],
      }),
    );
    expect(expense.some((c) => c.label === '笔数' && c.value === '3')).toBe(true);
    expect(expense.some((c) => c.label === '总额(控制)' && c.value === '100.00')).toBe(true);

    const recon = presentWorkflowResult(
      'FIN-RECONCILIATION-002',
      fakeResult({
        workflowId: 'FIN-RECONCILIATION-002',
        metrics: {
          bankInputTotal: '30.00',
          ledgerInputTotal: '30.00',
          matchedCount: 2,
          bankCount: 2,
          unmatchedBankTotal: '0.00',
          diffBank: '0.00',
          diffLedger: '0.00',
        },
      }),
    );
    expect(recon.some((c) => c.label === '匹配率' && c.value === '100.0%')).toBe(true);

    const arap = presentWorkflowResult(
      'FIN-ARAP-003',
      fakeResult({
        workflowId: 'FIN-ARAP-003',
        metrics: { openItemCount: 4, controlOpenAmount: '500.00', arCount: 2, apCount: 2 },
      }),
    );
    expect(arap.some((c) => c.label === '账龄口径')).toBe(true);

    const invoice = presentWorkflowResult(
      'FIN-INVOICE-OCR-004',
      fakeResult({
        workflowId: 'FIN-INVOICE-OCR-004',
        metrics: { invoiceCount: 1, ocrUnavailable: true, duplicateCount: 0 },
        status: 'NEEDS_REVIEW',
        exceptions: [{ code: 'OCR_PROVIDER_UNAVAILABLE', severity: 'BLOCKING', count: 1 }],
      }),
    );
    expect(invoice.some((c) => c.label === '无法识别/OCR' && c.value === 'OCR 不可用')).toBe(true);
    expect(
      financeNeedsReview(
        fakeResult({
          status: 'NEEDS_REVIEW',
          exceptions: [{ code: 'OCR_PROVIDER_UNAVAILABLE', severity: 'BLOCKING', count: 1 }],
        }),
      ),
    ).toBe(true);

    const ops = presentWorkflowResult(
      'FIN-OPERATING-SUMMARY-005',
      fakeResult({
        workflowId: 'FIN-OPERATING-SUMMARY-005',
        metrics: {
          revenueTotal: '200.00',
          costTotal: '90.00',
          expenseInputTotal: '20.00',
          allocatedExpenseTotal: '20.00',
          controlBalanced: true,
        },
        effectiveRules: { allocationMethod: 'REVENUE_SHARE' },
      }),
    );
    expect(ops.some((c) => c.label === '分摊是否平衡' && c.value === '平衡')).toBe(true);
    expect(aiSummaryLooksSafe({ rawRows: false, metrics: { revenueTotal: '1' } })).toBe(true);
  });
});
