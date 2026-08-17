import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createFileRuleStore,
  createRuleStore,
  createWorkflowRuntime,
  toEmployeeFileRules,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

type RunOpts = {
  files: unknown[][];
  rules?: Record<string, unknown>;
  companyId?: string;
  persisted?: Record<string, unknown>;
  runDate?: string;
  extraFiles?: unknown[][];
};

async function runEmployeeFile(options: RunOpts) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-efile-'));
  const inputFiles: Array<{ role: string; path: string }> = [];
  const path1 = join(dir, 'files1.xlsx');
  writeSheet(path1, options.files);
  inputFiles.push({ role: 'employee_files', path: path1 });
  if (options.extraFiles) {
    const path2 = join(dir, 'files2.xlsx');
    writeSheet(path2, options.extraFiles);
    inputFiles.push({ role: 'employee_files', path: path2 });
  }

  const persistedRuleStore = createFileRuleStore({ rootDir: dir });
  if (options.companyId && options.persisted) {
    await persistedRuleStore.saveWorkflowRules(options.companyId, 'HR-EMPLOYEE-FILE-003', options.persisted);
  }
  const runtime = createWorkflowRuntime({ persistedRuleStore });
  const result = await runtime.execute({
    workflowId: 'HR-EMPLOYEE-FILE-003',
    companyId: options.companyId,
    inputFiles,
    rules: options.rules,
    outputDir: join(dir, 'out'),
    runDate: options.runDate ?? '2026-07-15',
  });
  const workbook = result.outputFiles[0]
    ? XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' })
    : null;
  return { result, workbook, dir };
}

const normalFiles = [
  ['工号', '姓名', '部门', '入职日期', '在职状态', '手机', '身份证', '银行账号', '合同到期', '证照到期'],
  ['E001', '张三', '研发', '2024-01-10', '在职', '13800001111', '110101199001011234', '62220001', '2027-01-01', '2027-06-01'],
];

describe('HR-EMPLOYEE-FILE-003', () => {
  it('normal case builds standard archive with masking', async () => {
    const { result, workbook } = await runEmployeeFile({ files: normalFiles });
    expect(result.errorMessage).toBeUndefined();
    expect(result.status).toBe('COMPLETED');
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['标准员工档案']!);
    expect(String(rows[0]!.employeeName)).toContain('*');
    expect(String(rows[0]!.phone)).toContain('*');
    expect(String(rows[0]!.phone).endsWith('1111') || String(rows[0]!.phone).includes('*')).toBe(true);
    expect(rows[0]!.phoneHash).toBeTruthy();
    expect(rows[0]!.sourceTrace).toBeTruthy();
  });

  it('supports aliases and multi-file merge by employeeId', async () => {
    const { result, workbook } = await runEmployeeFile({
      files: [
        ['员工编号', '员工姓名', '部门', '入职日', '员工状态'],
        ['E002', '李四', '财务', '2023-05-01', '正式'],
      ],
      extraFiles: [
        ['工号', '姓名', '部门', '入职日期', '在职状态', '手机', '银行账号'],
        ['E002', '李四', '财务', '2023-05-01', '在职', '13900002222', '62220002'],
      ],
    });
    expect(result.errorMessage).toBeUndefined();
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['标准员工档案']!);
    expect(rows.length).toBe(1);
    expect(String(rows[0]!.bankAccount)).toContain('0002');
  });

  it('fails on missing required role', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-efile-miss-'));
    const result = await createWorkflowRuntime().execute({
      workflowId: 'HR-EMPLOYEE-FILE-003',
      inputFiles: [],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-15',
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toMatch(/Missing required input role/);
  });

  it('flags conflicts without auto-overwrite', async () => {
    const { result, workbook } = await runEmployeeFile({
      files: [
        ['工号', '姓名', '部门', '入职日期', '在职状态', '手机'],
        ['E001', '张三', '研发', '2024-01-10', '在职', '13800001111'],
        ['E001', '张三丰', '市场', '2024-01-10', '在职', '13800001111'],
      ],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.some((e) => e.code === 'FIELD_CONFLICT')).toBe(true);
    const conflict = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['重复冲突']!);
    expect(conflict[0]!.note).toMatch(/未自动覆盖/);
  });

  it('applies rule defaults', () => {
    const defaults = createRuleStore().getDefaults('HR-EMPLOYEE-FILE-003');
    expect(defaults.expiryWarningDays).toBe(30);
    expect(defaults.matchRule).toBe('EMPLOYEE_ID');
    const rules = toEmployeeFileRules(defaults);
    expect(rules.requiredDocuments).toContain('idCard');
  });

  it('loads company saved rules via createFileRuleStore', async () => {
    const { result, workbook } = await runEmployeeFile({
      files: [
        ['工号', '姓名', '部门', '入职日期', '在职状态', '合同到期'],
        ['E001', '张三', '研发', '2024-01-10', '在职', '2026-08-01'],
      ],
      companyId: 'co-efile',
      persisted: { expiryWarningDays: 60 },
      runDate: '2026-07-15',
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    const contract = XLSX.utils.sheet_to_json(workbook!.Sheets['合同到期']!);
    expect(contract.length).toBe(1);
  });

  it('request.rules overrides persisted and defaults', async () => {
    const { workbook } = await runEmployeeFile({
      files: [
        ['工号', '姓名', '部门', '入职日期', '在职状态', '合同到期'],
        ['E001', '张三', '研发', '2024-01-10', '在职', '2026-08-20'],
      ],
      companyId: 'co-efile-2',
      persisted: { expiryWarningDays: 60 },
      rules: { expiryWarningDays: 5 },
      runDate: '2026-07-15',
    });
    const contract = XLSX.utils.sheet_to_json(workbook!.Sheets['合同到期']!);
    expect(contract.length).toBe(0);
  });

  it('classifies missing docs and expiry as NEEDS_REVIEW', async () => {
    const { result, workbook } = await runEmployeeFile({
      files: [
        ['工号', '姓名', '部门', '入职日期', '在职状态', '合同到期', '证照到期'],
        ['E010', '王五', '销售', '2024-01-01', '在职', '2026-06-01', '2026-07-01'],
      ],
      runDate: '2026-07-15',
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(workbook!.SheetNames).toEqual([
      '标准员工档案',
      '重复冲突',
      '缺失资料',
      '合同到期',
      '证照到期',
      '运行说明',
    ]);
    expect(XLSX.utils.sheet_to_json(workbook!.Sheets['缺失资料']!).length).toBeGreaterThan(0);
  });

  it('writes readable XLSX with correct sheet names', async () => {
    const { result, workbook } = await runEmployeeFile({ files: normalFiles });
    expect(result.outputFiles[0]).toMatch(/员工档案整理_2026-07-15\.xlsx$/);
    expect(workbook!.SheetNames).toEqual([
      '标准员工档案',
      '重复冲突',
      '缺失资料',
      '合同到期',
      '证照到期',
      '运行说明',
    ]);
    const notes = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['运行说明']!);
    expect(notes.some((r) => r.key === 'cloudUpload' && (r.value === false || r.value === 'false'))).toBe(true);
  });

  it('fetch call count stays 0 and AI summary has no PII', async () => {
    let fetchCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return original(...args);
    }) as typeof fetch;
    try {
      const { result } = await runEmployeeFile({ files: normalFiles });
      expect(fetchCount).toBe(0);
      const payload = JSON.stringify(result.aiSummaryPayload);
      expect(payload).not.toContain('张三');
      expect(payload).not.toContain('E001');
      expect(payload).not.toContain('13800001111');
      expect(result.aiSummaryPayload?.rawRows).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('is deterministic across double runs', async () => {
    const a = await runEmployeeFile({ files: normalFiles });
    const b = await runEmployeeFile({ files: normalFiles });
    expect(a.result.metrics.employeeCount).toBe(b.result.metrics.employeeCount);
    expect(a.result.metrics.exceptionCount).toBe(b.result.metrics.exceptionCount);
  });
});
