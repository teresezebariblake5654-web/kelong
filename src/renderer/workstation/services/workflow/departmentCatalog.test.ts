import { describe, expect, it } from 'vitest';
import {
  ADMIN_WORKFLOW_IDS,
  FINANCE_WORKFLOW_IDS,
  HR_WORKFLOW_IDS,
  LOGISTICS_WORKFLOW_IDS,
  PRODUCTION_WORKFLOW_IDS,
  catalogCategoryFromDepartmentCode,
  checkWorkflowInputCapability,
  departmentRunPath,
  isHighRiskWorkflow,
  listAdminWorkflows,
  listDepartmentWorkflows,
  listFinanceWorkflows,
  listHrWorkflows,
  listLogisticsWorkflows,
  listProductionWorkflows,
  resolveDepartmentWorkflowId,
  roleAllowsMultipleFiles,
  sensitivityLevel,
} from './index';

describe('departmentCatalog', () => {
  it('lists production + HR + finance + ecommerce + logistics + admin catalogs', () => {
    expect(listHrWorkflows()).toHaveLength(7);
    expect(listHrWorkflows().map((w) => w.id)).toEqual([...HR_WORKFLOW_IDS]);
    expect(listProductionWorkflows()).toHaveLength(6);
    expect(listProductionWorkflows().map((w) => w.id)).toEqual([...PRODUCTION_WORKFLOW_IDS]);
    expect(listFinanceWorkflows()).toHaveLength(5);
    expect(listFinanceWorkflows().map((w) => w.id)).toEqual([...FINANCE_WORKFLOW_IDS]);
    expect(listDepartmentWorkflows('finance')).toHaveLength(5);
    expect(listDepartmentWorkflows('ecommerce')).toHaveLength(5);
    expect(listLogisticsWorkflows()).toHaveLength(5);
    expect(listLogisticsWorkflows().map((w) => w.id)).toEqual([...LOGISTICS_WORKFLOW_IDS]);
    expect(listAdminWorkflows()).toHaveLength(4);
    expect(listAdminWorkflows().map((w) => w.id)).toEqual([...ADMIN_WORKFLOW_IDS]);
    expect(listDepartmentWorkflows('logistics')).toHaveLength(5);
    expect(listDepartmentWorkflows('admin')).toHaveLength(4);
  });

  it('resolves mode / template codes for finance, ecommerce, logistics and admin', () => {
    expect(resolveDepartmentWorkflowId('finance', 'expense')).toBe('FIN-EXPENSE-CLEAN-001');
    expect(resolveDepartmentWorkflowId('finance', 'FIN_INVOICE_OCR')).toBe('FIN-INVOICE-OCR-004');
    expect(departmentRunPath('finance', 'FIN-ARAP-003')).toBe('/finance/workflows/FIN-ARAP-003');
    expect(resolveDepartmentWorkflowId('ecommerce', 'order-clean')).toBe('ECOM-ORDER-CLEAN-001');
    expect(resolveDepartmentWorkflowId('ecommerce', 'ECOM_LIVE_ORDER')).toBe('ECOM-LIVE-ORDER-004');
    expect(departmentRunPath('ecommerce', 'ECOM-REFUND-002')).toBe(
      '/ecommerce/workflows/ECOM-REFUND-002',
    );
    expect(resolveDepartmentWorkflowId('logistics', 'inventory')).toBe('LOG-INVENTORY-COUNT-001');
    expect(resolveDepartmentWorkflowId('logistics', 'LOG_STOCK_ALERT')).toBe('LOG-STOCK-ALERT-004');
    expect(departmentRunPath('logistics', 'LOG-TRANSFER-CLEAN-005')).toBe(
      '/logistics/workflows/LOG-TRANSFER-CLEAN-005',
    );
    expect(resolveDepartmentWorkflowId('admin', 'ADMIN_ASSET_INVENTORY')).toBe(
      'ADMIN-ASSET-INVENTORY-001',
    );
    expect(resolveDepartmentWorkflowId('admin', '会议室利用率')).toBe(
      'ADMIN-ROOM-UTILIZATION-003',
    );
    expect(departmentRunPath('admin', 'ADMIN-CONTRACT-EXPIRY-004')).toBe(
      '/admin/workflows/ADMIN-CONTRACT-EXPIRY-004',
    );
    expect(catalogCategoryFromDepartmentCode('logistics')).toBe('logistics');
    expect(catalogCategoryFromDepartmentCode('administration')).toBe('admin');
    expect(catalogCategoryFromDepartmentCode('admin')).toBe('admin');
    expect(catalogCategoryFromDepartmentCode('sales')).toBeNull();
  });

  it('marks finance high-risk and multi-file invoice role', () => {
    const recon = listFinanceWorkflows().find((w) => w.id === 'FIN-RECONCILIATION-002')!;
    const expense = listFinanceWorkflows().find((w) => w.id === 'FIN-EXPENSE-CLEAN-001')!;
    expect(isHighRiskWorkflow(recon)).toBe(true);
    expect(isHighRiskWorkflow(expense)).toBe(false);
    expect(sensitivityLevel(recon)).toBe('high');
    expect(roleAllowsMultipleFiles('invoice_files')).toBe(true);
  });
});

describe('workflowCapabilities', () => {
  it('blocks image/PDF invoice OCR without provider', () => {
    const blocked = checkWorkflowInputCapability({
      workflowId: 'FIN-INVOICE-OCR-004',
      role: 'invoice_files',
      fileName: 'scan.pdf',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('OCR_PROVIDER_UNAVAILABLE');
    expect(blocked.availableProviders).toContain('StructuredInvoiceProvider');

    const ok = checkWorkflowInputCapability({
      workflowId: 'FIN-INVOICE-OCR-004',
      role: 'invoice_files',
      fileName: 'invoices.xlsx',
    });
    expect(ok.ok).toBe(true);
  });
});
