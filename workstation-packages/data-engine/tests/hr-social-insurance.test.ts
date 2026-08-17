import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createFileRuleStore,
  createRuleStore,
  createWorkflowRuntime,
  moneyAdd,
  moneyToFixed,
  toSocialInsuranceRules,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

type RunOpts = {
  employee: unknown[][];
  base: unknown[][];
  payment: unknown[][];
  rules?: Record<string, unknown>;
  companyId?: string;
  persisted?: Record<string, unknown>;
  runDate?: string;
};

async function runSocial(options: RunOpts) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-social-'));
  const empPath = join(dir, 'emp.xlsx');
  const basePath = join(dir, 'base.xlsx');
  const payPath = join(dir, 'pay.xlsx');
  writeSheet(empPath, options.employee);
  writeSheet(basePath, options.base);
  writeSheet(payPath, options.payment);
  const persistedRuleStore = createFileRuleStore({ rootDir: dir });
  if (options.companyId && options.persisted) {
    await persistedRuleStore.saveWorkflowRules(options.companyId, 'HR-SOCIAL-INSURANCE-005', options.persisted);
  }
  const runtime = createWorkflowRuntime({ persistedRuleStore });
  const result = await runtime.execute({
    workflowId: 'HR-SOCIAL-INSURANCE-005',
    companyId: options.companyId,
    inputFiles: [
      { role: 'employee_master', path: empPath },
      { role: 'declared_base', path: basePath },
      { role: 'payment_detail', path: payPath },
    ],
    rules: options.rules,
    outputDir: join(dir, 'out'),
    runDate: options.runDate ?? '2026-07-15',
  });
  const workbook = result.outputFiles[0]
    ? XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' })
    : null;
  return { result, workbook, dir };
}

const normalEmployee = [
  ['工号', '姓名', '入职日期', '离职日期', '在职状态'],
  ['E001', '张三', '2024-01-10', '', '在职'],
];
const normalBase = [
  ['工号', '社保基数', '公积金基数'],
  ['E001', 10000, 10000],
];
// employeeInsurance 10000*0.105=1050; fund 10000*0.12=1200
const normalPayment = [
  ['工号', '社保金额', '公积金金额', '缴费月'],
  ['E001', 1050, 1200, '2026-07'],
];

describe('money helpers for social', () => {
  it('Decimal 0.1+0.2 precision via moneyAdd', () => {
    expect(moneyToFixed(moneyAdd('0.1', '0.2'))).toBe('0.30');
    expect(String(moneyAdd(0.1, 0.2))).not.toContain('0000004');
  });
});

describe('HR-SOCIAL-INSURANCE-005', () => {
  it('normal case matches expected amounts', async () => {
    const { result, workbook } = await runSocial({
      employee: normalEmployee,
      base: normalBase,
      payment: normalPayment,
    });
    expect(result.errorMessage).toBeUndefined();
    expect(result.status).toBe('COMPLETED');
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['核对总表']!);
    expect(rows[0]!.expectedInsurance).toBe('1050.00');
    expect(rows[0]!.expectedFund).toBe('1200.00');
    expect(rows[0]!.status).toBe('OK');
    expect(rows[0]!.policyVersion).toBe('v1');
  });

  it('supports Chinese aliases', async () => {
    const { workbook } = await runSocial({
      employee: [
        ['员工编号', '入职日', '员工状态'],
        ['E002', '2023-05-01', '正式'],
      ],
      base: [
        ['员工号', '保险基数', '住房基数'],
        ['E002', 10000, 10000],
      ],
      payment: [
        ['工号', '保险金额', '住房金额', '所属月'],
        ['E002', 1050, 1200, '2026-07'],
      ],
    });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['核对总表']!);
    expect(rows[0]!.employeeId).toBe('E002');
  });

  it('fails on missing required role', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-social-miss-'));
    const empPath = join(dir, 'emp.xlsx');
    writeSheet(empPath, normalEmployee);
    const result = await createWorkflowRuntime().execute({
      workflowId: 'HR-SOCIAL-INSURANCE-005',
      inputFiles: [{ role: 'employee_master', path: empPath }],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-15',
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toMatch(/Missing required input role/);
  });

  it('flags missing payment and duplicates as NEEDS_REVIEW', async () => {
    const { result, workbook } = await runSocial({
      employee: normalEmployee,
      base: normalBase,
      payment: [
        ['工号', '社保金额', '公积金金额', '缴费月'],
        ['E001', 1050, 1200, '2026-07'],
        ['E001', 1050.01, 1200, '2026-07'],
      ],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.some((e) => e.code === 'DUPLICATE_PAYMENT')).toBe(true);
    expect(XLSX.utils.sheet_to_json(workbook!.Sheets['重复缴费']!).length).toBeGreaterThan(0);
  });

  it('applies rule defaults', () => {
    const defaults = createRuleStore().getDefaults('HR-SOCIAL-INSURANCE-005');
    expect(defaults.policyVersion).toBe('v1');
    expect(defaults.minBase).toBe('3523');
    const rules = toSocialInsuranceRules(defaults);
    expect(rules.employeeInsuranceRate).toBe('0.105');
  });

  it('loads company saved rules via createFileRuleStore', async () => {
    const { workbook } = await runSocial({
      employee: normalEmployee,
      base: normalBase,
      payment: [['工号', '社保金额', '公积金金额', '缴费月'], ['E001', 2000, 1200, '2026-07']],
      companyId: 'co-social',
      persisted: { employeeInsuranceRate: '0.2' },
    });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['核对总表']!);
    expect(rows[0]!.expectedInsurance).toBe('2000.00');
  });

  it('request.rules overrides persisted and defaults', async () => {
    const { workbook } = await runSocial({
      employee: normalEmployee,
      base: normalBase,
      payment: normalPayment,
      companyId: 'co-social-2',
      persisted: { employeeInsuranceRate: '0.2' },
      rules: { employeeInsuranceRate: '0.105' },
    });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['核对总表']!);
    expect(rows[0]!.expectedInsurance).toBe('1050.00');
  });

  it('classifies base anomaly and amount mismatch', async () => {
    const { result, workbook } = await runSocial({
      employee: [
        ['工号', '入职日期', '在职状态'],
        ['E010', '2024-01-01', '在职'],
        ['E011', '2024-01-01', '在职'],
      ],
      base: [
        ['工号', '社保基数', '公积金基数'],
        ['E010', 1000, 1000],
        ['E011', 10000, 10000],
      ],
      payment: [
        ['工号', '社保金额', '公积金金额', '缴费月'],
        ['E011', 500, 100, '2026-07'],
      ],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(workbook!.SheetNames).toEqual([
      '核对总表',
      '漏缴清单',
      '重复缴费',
      '基数异常',
      '金额差异',
      '规则版本',
      '运行说明',
    ]);
    expect(XLSX.utils.sheet_to_json(workbook!.Sheets['基数异常']!).length).toBeGreaterThan(0);
    expect(XLSX.utils.sheet_to_json(workbook!.Sheets['金额差异']!).length).toBeGreaterThan(0);
    expect(XLSX.utils.sheet_to_json(workbook!.Sheets['漏缴清单']!).length).toBeGreaterThan(0);
  });

  it('writes readable XLSX with policy version sheet', async () => {
    const { result, workbook } = await runSocial({
      employee: normalEmployee,
      base: normalBase,
      payment: normalPayment,
    });
    expect(result.outputFiles[0]).toMatch(/社保公积金核对_2026-07\.xlsx$/);
    const version = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['规则版本']!);
    expect(version.some((r) => r.key === 'version' || r.key === 'policyVersion')).toBe(true);
    expect(result.metrics.policyVersion).toBe('v1');
  });

  it('fetch call count stays 0 and AI summary has no PII', async () => {
    let fetchCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return original(...args);
    }) as typeof fetch;
    try {
      const { result } = await runSocial({
        employee: normalEmployee,
        base: normalBase,
        payment: normalPayment,
      });
      expect(fetchCount).toBe(0);
      const payload = JSON.stringify(result.aiSummaryPayload);
      expect(payload).not.toContain('张三');
      expect(payload).not.toContain('E001');
      expect(result.aiSummaryPayload?.rawRows).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('is deterministic across double runs', async () => {
    const input = { employee: normalEmployee, base: normalBase, payment: normalPayment };
    const a = await runSocial(input);
    const b = await runSocial(input);
    expect(a.result.metrics.employeeCount).toBe(b.result.metrics.employeeCount);
    expect(a.result.metrics.exceptionCount).toBe(b.result.metrics.exceptionCount);
  });
});
