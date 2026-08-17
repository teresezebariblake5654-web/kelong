import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import {
  NodeTestWorkflowBridge,
  assertNoPathTraversal,
  deriveUiStatus,
  isPathInsideWorkspace,
  listProductionWorkflows,
  PRODUCTION_WORKFLOW_IDS,
  canStartRun,
  isRunLocked,
  mapResultStatusToUi,
  aiSummaryLooksSafe,
} from './index';

function sheetBytes(rows: unknown[][]): Uint8Array {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return new Uint8Array(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

describe('production catalog for desktop', () => {
  it('lists exactly 6 production workflows with expected roles', () => {
    const list = listProductionWorkflows();
    expect(list).toHaveLength(6);
    expect(list.map((w) => w.id)).toEqual([...PRODUCTION_WORKFLOW_IDS]);

    const material = list.find((w) => w.id === 'PROD-MATERIAL-DAILY-001')!;
    expect(material.inputRoles.map((r) => r.role)).toEqual([
      'opening_stock',
      'movements',
      'physical_count',
    ]);
    expect(material.inputRoles.find((r) => r.role === 'physical_count')?.required).toBe(false);
    expect(material.inputRoles.filter((r) => r.required)).toHaveLength(2);

    const quality = list.find((w) => w.id === 'PROD-QUALITY-005')!;
    expect(quality.inputRoles.map((r) => r.role)).toEqual(['inspection', 'quality_standard']);
  });
});

describe('ui status helpers', () => {
  it('maps result statuses and locks run', () => {
    expect(mapResultStatusToUi('NEEDS_REVIEW')).toBe('NEEDS_REVIEW');
    expect(mapResultStatusToUi('FAILED')).toBe('FAILED');
    expect(mapResultStatusToUi('COMPLETED')).toBe('COMPLETED');
    expect(isRunLocked('RUNNING')).toBe(true);
    expect(canStartRun('READY')).toBe(true);
    expect(canStartRun('RUNNING')).toBe(false);
    expect(
      deriveUiStatus({
        hasRequiredFiles: true,
        parsing: false,
        running: false,
        lastResultStatus: 'NEEDS_REVIEW',
      }),
    ).toBe('NEEDS_REVIEW');
  });
});

describe('path safety', () => {
  it('blocks traversal and enforces workspace', () => {
    expect(() => assertNoPathTraversal('../secret')).toThrow();
    expect(isPathInsideWorkspace('D:/ws/out/a.xlsx', 'D:/ws')).toBe(true);
    expect(isPathInsideWorkspace('D:/other/a.xlsx', 'D:/ws')).toBe(false);
    expect(isPathInsideWorkspace('memory://a.xlsx', 'browser-workspace')).toBe(true);
  });
});

describe('NodeTestWorkflowBridge integration', () => {
  it('runs PROD-MATERIAL-DAILY-001 and writes real xlsx without fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const rootDir = mkdtempSync(join(tmpdir(), 'aw-desktop-md-'));
    const bridge = new NodeTestWorkflowBridge({ rootDir, companyId: 'demo' });

    await bridge.saveWorkflowRules('PROD-MATERIAL-DAILY-001', {
      'materialDaily.toleranceQty': 1,
      'materialDaily.toleranceRate': 0.05,
      'materialDaily.negativeStockBlocked': true,
    });
    const rules = await bridge.getWorkflowRules('PROD-MATERIAL-DAILY-001');
    expect(rules.company['materialDaily.toleranceQty']).toBe(1);
    expect(rules.effective['materialDaily.toleranceQty']).toBe(1);

    const opening = sheetBytes([
      ['物料编码', '物料名称', '仓库', '期初数量', '单位'],
      ['M001', '螺丝', '原料仓', 100, 'PCS'],
    ]);
    const movements = sheetBytes([
      ['日期', '物料编码', '类型', '数量', '仓库', '单位'],
      ['2026-07-01', 'M001', '入库', 20, '原料仓', 'PCS'],
      ['2026-07-01', 'M001', '领料', 30, '原料仓', 'PCS'],
    ]);
    const count = sheetBytes([
      ['物料编码', '仓库', '实盘数量', '单位'],
      ['M001', '原料仓', 95, 'PCS'],
    ]);

    const inspect = await bridge.inspectInputFile({
      workflowId: 'PROD-MATERIAL-DAILY-001',
      role: 'opening_stock',
      path: 'memory://opening.xlsx',
      bytes: opening,
      fileName: 'opening.xlsx',
    });
    expect(inspect.canRunRole).toBe(true);
    expect(inspect.missingRequiredFields).toEqual([]);

    const result = await bridge.executeWorkflow({
      workflowId: 'PROD-MATERIAL-DAILY-001',
      companyId: 'demo',
      runDate: '2026-07-22',
      inputFiles: [
        {
          role: 'opening_stock',
          path: 'memory://opening.xlsx',
          sha256: 'a',
          originalName: 'opening.xlsx',
          bytes: opening,
        },
        {
          role: 'movements',
          path: 'memory://movements.xlsx',
          sha256: 'b',
          originalName: 'movements.xlsx',
          bytes: movements,
        },
        {
          role: 'physical_count',
          path: 'memory://count.xlsx',
          sha256: 'c',
          originalName: 'count.xlsx',
          bytes: count,
        },
      ],
    });

    expect(result.cloudUpload).toBe(false);
    expect(['COMPLETED', 'NEEDS_REVIEW']).toContain(result.status);
    expect(result.outputFiles.length).toBeGreaterThan(0);
    const out = result.outputFiles[0]!;
    expect(existsSync(out)).toBe(true);
    const workbook = XLSX.read(readFileSync(out), { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(
      expect.arrayContaining(['日清总表', '库存差异', '负库存', '缺失数据', '运行说明']),
    );
    expect(bridge.getFetchCallCount()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('runs PROD-QUALITY-005 and surfaces NEEDS_REVIEW without network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const rootDir = mkdtempSync(join(tmpdir(), 'aw-desktop-qa-'));
    const bridge = new NodeTestWorkflowBridge({ rootDir, companyId: 'demo' });

    const inspection = sheetBytes([
      ['检验单号', '检验日期', '产品编码', '批次号', '工单号', '检验项目', '结果', '缺陷类型', '缺陷等级'],
      ['I-1', '2026-07-20', 'P-1', 'L-1', 'WO-1', '尺寸', 5, '', ''],
      ['I-2', '2026-07-20', 'P-1', 'L-1', 'WO-1', '尺寸', 20, '超差', '一般'],
      ['I-3', '2026-07-20', 'P-1', 'L-2', 'WO-1', '外观', '不合格', '裂纹', '致命'],
    ]);
    const standard = sheetBytes([
      ['产品编码', '检验项目', '下限', '上限', '期望值', '结果类型'],
      ['P-1', '尺寸', 1, 10, '', 'NUMERIC'],
      ['P-1', '外观', '', '', '合格', 'BOOLEAN'],
    ]);

    const result = await bridge.executeWorkflow({
      workflowId: 'PROD-QUALITY-005',
      companyId: 'demo',
      runDate: '2026-07-22',
      inputFiles: [
        {
          role: 'inspection',
          path: 'memory://inspection.xlsx',
          sha256: 'i',
          originalName: 'inspection.xlsx',
          bytes: inspection,
        },
        {
          role: 'quality_standard',
          path: 'memory://standard.xlsx',
          sha256: 's',
          originalName: 'standard.xlsx',
          bytes: standard,
        },
      ],
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.length).toBeGreaterThan(0);
    expect(result.outputFiles[0] && existsSync(result.outputFiles[0])).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    await expect(
      bridge.executeWorkflow({
        workflowId: 'PROD-QUALITY-005',
        companyId: 'demo',
        inputFiles: [],
      }),
    ).rejects.toMatchObject({ code: 'MISSING_REQUIRED_ROLE' });
  });

  it('prevents duplicate concurrent runs', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aw-desktop-lock-'));
    const bridge = new NodeTestWorkflowBridge({ rootDir, companyId: 'demo' });
    (bridge as unknown as { running: boolean }).running = true;
    await expect(
      bridge.executeWorkflow({
        workflowId: 'PROD-MATERIAL-DAILY-001',
        companyId: 'demo',
        inputFiles: [],
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_RUNNING' });
  });
});

describe('NodeTestWorkflowBridge HR integration', () => {
  it('runs HR-PAYROLL-001 with bank totals and safe AI summary', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const rootDir = mkdtempSync(join(tmpdir(), 'aw-desktop-hr-pay-'));
    const bridge = new NodeTestWorkflowBridge({ rootDir, companyId: 'demo' });

    const employee = sheetBytes([
      ['工号', '姓名', '部门', '在职状态', '入职日期', '银行账号', '开户行'],
      ['E001', '张三', '研发', '在职', '2024-01-10', '62220001', '工行'],
    ]);
    const salary = sheetBytes([
      ['工号', '基本工资', '时薪'],
      ['E001', 8700, 50],
    ]);
    const attendance = sheetBytes([
      ['工号', '应出勤天数', '实出勤天数', '缺勤天数', '加班小时', '迟到分钟'],
      ['E001', 21.75, 21.75, 0, 0, 0],
    ]);

    const result = await bridge.executeWorkflow({
      workflowId: 'HR-PAYROLL-001',
      companyId: 'demo',
      runDate: '2026-07-22',
      inputFiles: [
        {
          role: 'employee_master',
          path: 'memory://emp.xlsx',
          sha256: 'e',
          originalName: 'emp.xlsx',
          bytes: employee,
        },
        {
          role: 'salary_standard',
          path: 'memory://sal.xlsx',
          sha256: 's',
          originalName: 'sal.xlsx',
          bytes: salary,
        },
        {
          role: 'attendance_summary',
          path: 'memory://att.xlsx',
          sha256: 'a',
          originalName: 'att.xlsx',
          bytes: attendance,
        },
      ],
    });

    expect(result.cloudUpload).toBe(false);
    expect(['COMPLETED', 'NEEDS_REVIEW']).toContain(result.status);
    expect(result.metrics.bankNetPayTotal).toBe(result.metrics.netPayTotal);
    expect(result.outputFiles[0] && existsSync(result.outputFiles[0])).toBe(true);
    const workbook = XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(
      expect.arrayContaining(['工资明细', '银行发薪', '部门汇总', '异常待人工', '规则快照', '运行说明']),
    );
    expect(aiSummaryLooksSafe(result.aiSummaryPayload as Record<string, unknown> | undefined)).toBe(
      true,
    );
    expect(bridge.getFetchCallCount()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('runs HR-ATTENDANCE-002 without network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const rootDir = mkdtempSync(join(tmpdir(), 'aw-desktop-hr-att-'));
    const bridge = new NodeTestWorkflowBridge({ rootDir, companyId: 'demo' });

    const result = await bridge.executeWorkflow({
      workflowId: 'HR-ATTENDANCE-002',
      companyId: 'demo',
      runDate: '2026-07-22',
      inputFiles: [
        {
          role: 'employee_master',
          path: 'memory://emp.xlsx',
          sha256: 'e',
          originalName: 'emp.xlsx',
          bytes: sheetBytes([
            ['工号', '姓名', '部门', '在职状态'],
            ['E001', '张三', '研发', '在职'],
          ]),
        },
        {
          role: 'schedule',
          path: 'memory://sch.xlsx',
          sha256: 's',
          originalName: 'sch.xlsx',
          bytes: sheetBytes([
            ['工号', '日期', '上班时间', '下班时间'],
            ['E001', '2026-07-01', '09:00', '18:00'],
          ]),
        },
        {
          role: 'punch',
          path: 'memory://punch.xlsx',
          sha256: 'p',
          originalName: 'punch.xlsx',
          bytes: sheetBytes([
            ['工号', '打卡时间'],
            ['E001', '2026-07-01 09:00'],
            ['E001', '2026-07-01 18:00'],
          ]),
        },
      ],
    });

    expect(['COMPLETED', 'NEEDS_REVIEW']).toContain(result.status);
    const workbook = XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(
      expect.arrayContaining(['考勤明细', '异常待确认', '加班统计', '缺卡清单', '运行说明']),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('runs HR-EMPLOYEE-FILE-003 with multi-file employee_files', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const rootDir = mkdtempSync(join(tmpdir(), 'aw-desktop-hr-file-'));
    const bridge = new NodeTestWorkflowBridge({ rootDir, companyId: 'demo' });

    const file1 = sheetBytes([
      ['工号', '姓名', '部门', '入职日期', '在职状态'],
      ['E002', '李四', '财务', '2023-05-01', '正式'],
    ]);
    const file2 = sheetBytes([
      ['工号', '姓名', '部门', '入职日期', '在职状态', '手机', '银行账号'],
      ['E002', '李四', '财务', '2023-05-01', '在职', '13900002222', '62220002'],
    ]);

    const inspect = await bridge.inspectWorkflowInput({
      workflowId: 'HR-EMPLOYEE-FILE-003',
      role: 'employee_files',
      files: [
        { name: 'files1.xlsx', bytes: file1 },
        { name: 'files2.xlsx', bytes: file2 },
      ],
    });
    expect(inspect.fileCount).toBe(2);
    expect(inspect.canRunRole).toBe(true);
    expect(inspect.fieldPreviews.every((p) => typeof p.maskedSample === 'string')).toBe(true);

    const result = await bridge.executeWorkflow({
      workflowId: 'HR-EMPLOYEE-FILE-003',
      companyId: 'demo',
      runDate: '2026-07-22',
      inputFiles: [
        {
          role: 'employee_files',
          path: 'memory://files1.xlsx',
          sha256: 'f1',
          originalName: 'files1.xlsx',
          bytes: file1,
        },
        {
          role: 'employee_files',
          path: 'memory://files2.xlsx',
          sha256: 'f2',
          originalName: 'files2.xlsx',
          bytes: file2,
        },
      ],
    });

    expect(['COMPLETED', 'NEEDS_REVIEW']).toContain(result.status);
    const workbook = XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(
      expect.arrayContaining(['标准员工档案', '重复冲突', '缺失资料', '运行说明']),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(bridge.getFetchCallCount()).toBe(0);
    fetchSpy.mockRestore();
  });

  it('runs FIN-EXPENSE-CLEAN-001 and writes real xlsx without fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const rootDir = mkdtempSync(join(tmpdir(), 'aw-desktop-fin-exp-'));
    const bridge = new NodeTestWorkflowBridge({ rootDir, companyId: 'demo' });

    const result = await bridge.executeWorkflow({
      workflowId: 'FIN-EXPENSE-CLEAN-001',
      companyId: 'demo',
      runDate: '2026-07-15',
      inputFiles: [
        {
          role: 'expense',
          path: 'memory://expense.xlsx',
          sha256: 'ex',
          originalName: 'expense.xlsx',
          bytes: sheetBytes([
            ['费用编号', '日期', '报销人', '金额', '税额', '说明', '费用类型', '有票'],
            ['EX001', '2026-07-10', '张三', '0.1', '0.2', '差旅住宿', '差旅', '是'],
          ]),
        },
        {
          role: 'mapping',
          path: 'memory://map.xlsx',
          sha256: 'map',
          originalName: 'map.xlsx',
          bytes: sheetBytes([
            ['关键词', '科目代码'],
            ['差旅', '6602'],
          ]),
        },
      ],
    });

    expect(['COMPLETED', 'NEEDS_REVIEW']).toContain(result.status);
    expect(result.cloudUpload).toBe(false);
    expect(existsSync(result.outputFiles[0]!)).toBe(true);
    expect(result.outputFiles[0]).toMatch(/费用整理结果_2026-07-15\.xlsx$/);
    const workbook = XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(
      expect.arrayContaining(['标准费用明细', '运行说明']),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('runs FIN-RECONCILIATION-002 with control totals closed', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const rootDir = mkdtempSync(join(tmpdir(), 'aw-desktop-fin-rec-'));
    const bridge = new NodeTestWorkflowBridge({ rootDir, companyId: 'demo' });

    const result = await bridge.executeWorkflow({
      workflowId: 'FIN-RECONCILIATION-002',
      companyId: 'demo',
      runDate: '2026-07-15',
      inputFiles: [
        {
          role: 'bank_statement',
          path: 'memory://bank.xlsx',
          sha256: 'b',
          originalName: 'bank.xlsx',
          bytes: sheetBytes([
            ['流水号', '日期', '金额', '方向', '对方', '摘要', '参考号'],
            ['B1', '2026-07-10', '0.1', 'IN', '客户A', '收款', 'R001'],
            ['B2', '2026-07-11', '0.2', 'IN', '客户A', '收款', 'R002'],
          ]),
        },
        {
          role: 'ledger',
          path: 'memory://ledger.xlsx',
          sha256: 'l',
          originalName: 'ledger.xlsx',
          bytes: sheetBytes([
            ['单据号', '日期', '金额', '方向', '对方', '状态', '参考号'],
            ['L1', '2026-07-10', '0.1', 'IN', '客户A', 'OPEN', 'R001'],
            ['L2', '2026-07-11', '0.2', 'IN', '客户A', 'OPEN', 'R002'],
          ]),
        },
      ],
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.metrics.diffBank).toBe('0.00');
    expect(result.metrics.autoWriteOff).toBe(false);
    expect(existsSync(result.outputFiles[0]!)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('runs FIN-INVOICE-OCR-004 structured and blocks PDF OCR capability', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const rootDir = mkdtempSync(join(tmpdir(), 'aw-desktop-fin-inv-'));
    const bridge = new NodeTestWorkflowBridge({ rootDir, companyId: 'demo' });

    const capability = bridge.checkWorkflowInputCapability({
      workflowId: 'FIN-INVOICE-OCR-004',
      role: 'invoice_files',
      fileName: 'scan.pdf',
    });
    expect(capability.ok).toBe(false);
    expect(capability.code).toBe('OCR_PROVIDER_UNAVAILABLE');

    const result = await bridge.executeWorkflow({
      workflowId: 'FIN-INVOICE-OCR-004',
      companyId: 'demo',
      runDate: '2026-07-15',
      inputFiles: [
        {
          role: 'invoice_files',
          path: 'memory://invoices.xlsx',
          sha256: 'inv',
          originalName: 'invoices.xlsx',
          bytes: sheetBytes([
            ['发票代码', '发票号码', '开票日期', '销方名称', '销方税号', '金额', '税额', '价税合计'],
            ['110', '0001', '2026-07-01', '供应商A', 'T001', '0.1', '0.2', '0.30'],
          ]),
        },
      ],
    });

    expect(['COMPLETED', 'NEEDS_REVIEW']).toContain(result.status);
    expect(result.metrics.cloudOcr).toBe(false);
    expect(result.outputFiles[0]).toMatch(/发票识别与核对_2026-07-15\.xlsx$/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('runs FIN-OPERATING-SUMMARY-005 with balanced allocation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const rootDir = mkdtempSync(join(tmpdir(), 'aw-desktop-fin-ops-'));
    const bridge = new NodeTestWorkflowBridge({ rootDir, companyId: 'demo' });

    const result = await bridge.executeWorkflow({
      workflowId: 'FIN-OPERATING-SUMMARY-005',
      companyId: 'demo',
      runDate: '2026-07-15',
      inputFiles: [
        {
          role: 'revenue',
          path: 'memory://rev.xlsx',
          sha256: 'r',
          originalName: 'rev.xlsx',
          bytes: sheetBytes([
            ['日期', '业务单元', '产品', '收入'],
            ['2026-07-01', 'BU1', 'P1', 100],
            ['2026-07-01', 'BU2', 'P2', 100],
          ]),
        },
        {
          role: 'cost',
          path: 'memory://cost.xlsx',
          sha256: 'c',
          originalName: 'cost.xlsx',
          bytes: sheetBytes([
            ['日期', '业务单元', '产品', '成本'],
            ['2026-07-01', 'BU1', 'P1', 40],
            ['2026-07-01', 'BU2', 'P2', 50],
          ]),
        },
        {
          role: 'expense',
          path: 'memory://exp.xlsx',
          sha256: 'e',
          originalName: 'exp.xlsx',
          bytes: sheetBytes([
            ['日期', '业务单元', '费用类型', '金额'],
            ['2026-07-01', '', '共享费用', 20],
          ]),
        },
      ],
    });

    expect(['COMPLETED', 'NEEDS_REVIEW']).toContain(result.status);
    expect(result.metrics.controlBalanced).toBe(true);
    expect(existsSync(result.outputFiles[0]!)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/622202\d{10}/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
