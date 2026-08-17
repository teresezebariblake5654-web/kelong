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
  toPayrollRules,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

type RunOpts = {
  employee: unknown[][];
  salary: unknown[][];
  attendance: unknown[][];
  adjustments?: unknown[][];
  socialTax?: unknown[][];
  rules?: Record<string, unknown>;
  companyId?: string;
  persisted?: Record<string, unknown>;
  runDate?: string;
};

async function runPayroll(options: RunOpts) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-payroll-'));
  const empPath = join(dir, 'emp.xlsx');
  const salPath = join(dir, 'sal.xlsx');
  const attPath = join(dir, 'att.xlsx');
  writeSheet(empPath, options.employee);
  writeSheet(salPath, options.salary);
  writeSheet(attPath, options.attendance);
  const inputFiles: Array<{ role: string; path: string }> = [
    { role: 'employee_master', path: empPath },
    { role: 'salary_standard', path: salPath },
    { role: 'attendance_summary', path: attPath },
  ];
  if (options.adjustments) {
    const p = join(dir, 'adj.xlsx');
    writeSheet(p, options.adjustments);
    inputFiles.push({ role: 'adjustments', path: p });
  }
  if (options.socialTax) {
    const p = join(dir, 'tax.xlsx');
    writeSheet(p, options.socialTax);
    inputFiles.push({ role: 'social_tax', path: p });
  }

  const persistedRuleStore = createFileRuleStore({ rootDir: dir });
  if (options.companyId && options.persisted) {
    await persistedRuleStore.saveWorkflowRules(options.companyId, 'HR-PAYROLL-001', options.persisted);
  }
  const runtime = createWorkflowRuntime({ persistedRuleStore });
  const result = await runtime.execute({
    workflowId: 'HR-PAYROLL-001',
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

const normalEmployee = [
  ['工号', '姓名', '部门', '在职状态', '入职日期', '银行账号', '开户行'],
  ['E001', '张三', '研发', '在职', '2024-01-10', '62220001', '工行'],
];
const normalSalary = [
  ['工号', '基本工资', '岗位工资', '绩效工资', '时薪'],
  ['E001', 8700, 0, 0, 50],
];
const normalAttendance = [
  ['工号', '应出勤天数', '实出勤天数', '缺勤天数', '加班小时', '迟到分钟'],
  ['E001', 21.75, 21.75, 0, 10, 0],
];

describe('money helpers', () => {
  it('Decimal 0.1+0.2 precision via moneyAdd', () => {
    expect(moneyToFixed(moneyAdd('0.1', '0.2'))).toBe('0.30');
    expect(String(moneyAdd(0.1, 0.2))).not.toContain('0000004');
  });
});

describe('HR-PAYROLL-001', () => {
  it('normal case computes correct netPay', async () => {
    // daily=8700/21.75=400; OT=10*50*1.5=750; gross=8700+750=9450; net=9450
    const { result, workbook } = await runPayroll({
      employee: normalEmployee,
      salary: normalSalary,
      attendance: normalAttendance,
    });
    expect(result.errorMessage).toBeUndefined();
    expect(result.status).toBe('COMPLETED');
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['工资明细']!);
    expect(rows[0]!.netPay).toBe('9450.00');
    expect(rows[0]!.grossPay).toBe('9450.00');
    expect(rows[0]!.status).toBe('READY_TO_PAY');
    expect(rows[0]!.dailySalary).toBe('400.00');
    expect(rows[0]!.overtimePay).toBe('750.00');
  });

  it('supports Chinese field aliases and workDays', async () => {
    const { result, workbook } = await runPayroll({
      employee: [
        ['员工编号', '员工姓名', '部门', '员工状态', '入职日', '银行卡号', '银行'],
        ['E002', '李四', '财务', '正式', '2023-05-01', '62220002', '建行'],
      ],
      salary: [
        ['员工号', '底薪'],
        ['E002', 4350],
      ],
      attendance: [
        ['工号', '工作天数', '出勤天数', '旷工天数', '加班时长', '迟到时长'],
        ['E002', 21.75, 20, 0, 0, 0],
      ],
    });
    expect(result.errorMessage).toBeUndefined();
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['工资明细']!);
    expect(rows[0]!.employeeId).toBe('E002');
    expect(rows[0]!.netPay).toBe('4350.00');
    expect(rows[0]!.payableDays).toBe(21.75);
  });

  it('fails on missing required role', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-payroll-miss-'));
    const empPath = join(dir, 'emp.xlsx');
    writeSheet(empPath, normalEmployee);
    const result = await createWorkflowRuntime().execute({
      workflowId: 'HR-PAYROLL-001',
      inputFiles: [{ role: 'employee_master', path: empPath }],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-15',
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toMatch(/Missing required input role/);
  });

  it('flags duplicate employees as NEEDS_REVIEW', async () => {
    const { result, workbook } = await runPayroll({
      employee: [
        ['工号', '姓名', '部门', '在职状态', '入职日期', '银行账号', '开户行'],
        ['E001', '张三', '研发', '在职', '2024-01-10', '62220001', '工行'],
        ['E001', '张三副本', '研发', '在职', '2024-01-10', '62220009', '工行'],
      ],
      salary: [
        ['工号', '基本工资', '时薪'],
        ['E001', 8700, 50],
      ],
      attendance: [
        ['工号', '应出勤天数', '实出勤天数', '缺勤天数', '加班小时', '迟到分钟'],
        ['E001', 21.75, 21.75, 0, 0, 0],
      ],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.some((e) => e.code === 'DUPLICATE_EMPLOYEE')).toBe(true);
    const bank = XLSX.utils.sheet_to_json(workbook!.Sheets['银行发薪']!);
    expect(bank.length).toBe(0);
  });

  it('applies rule defaults', () => {
    const defaults = createRuleStore().getDefaults('HR-PAYROLL-001');
    expect(defaults.standardPayableDays).toBe(21.75);
    expect(defaults['payroll.payableDays']).toBe(21.75);
    expect(defaults.overtimeMultiplier).toBe(1.5);
    expect(defaults.lateDeductionPerMinute).toBe('1');
    expect(defaults.absenceDeductionMode).toBe('DAILY_SALARY');
    expect(defaults.roundingScale).toBe(2);
    expect(defaults.roundingMode).toBe('HALF_UP');
    expect(defaults.negativeNetPayBlocked).toBe(true);
    expect(defaults.payrollChangeWarningRate).toBe(0.3);
    const rules = toPayrollRules(defaults);
    expect(rules.standardPayableDays).toBe(21.75);
    expect(rules.overtimeMultiplier).toBe(1.5);
  });

  it('loads company saved rules via createFileRuleStore', async () => {
    const { result, workbook } = await runPayroll({
      employee: normalEmployee,
      salary: [['工号', '基本工资', '时薪'], ['E001', 8700, 50]],
      attendance: [
        ['工号', '应出勤天数', '实出勤天数', '缺勤天数', '加班小时', '迟到分钟'],
        ['E001', 21.75, 21.75, 0, 10, 0],
      ],
      companyId: 'co-payroll',
      persisted: { overtimeMultiplier: 2 },
    });
    expect(result.errorMessage).toBeUndefined();
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['工资明细']!);
    // OT = 10*50*2 = 1000; net = 8700+1000 = 9700
    expect(rows[0]!.overtimePay).toBe('1000.00');
    expect(rows[0]!.netPay).toBe('9700.00');
  });

  it('request.rules overrides persisted and defaults', async () => {
    const { workbook } = await runPayroll({
      employee: normalEmployee,
      salary: [['工号', '基本工资', '时薪'], ['E001', 8700, 50]],
      attendance: [
        ['工号', '应出勤天数', '实出勤天数', '缺勤天数', '加班小时', '迟到分钟'],
        ['E001', 21.75, 21.75, 0, 10, 0],
      ],
      companyId: 'co-payroll-2',
      persisted: { overtimeMultiplier: 2 },
      rules: { overtimeMultiplier: 3 },
    });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['工资明细']!);
    expect(rows[0]!.overtimePay).toBe('1500.00');
    expect(rows[0]!.netPay).toBe('10200.00');
  });

  it('classifies exceptions and sets NEEDS_REVIEW', async () => {
    const { result, workbook } = await runPayroll({
      employee: [
        ['工号', '姓名', '部门', '在职状态', '入职日期', '银行账号', '开户行', '上月实发'],
        ['E010', '王五', '销售', '离职', '2026-07-01', '', '工行', 5000],
        ['E011', '赵六', '销售', '在职', '2024-01-01', '62221111', '工行', 1000],
      ],
      salary: [
        ['工号', '基本工资', '时薪'],
        ['E011', 8700, 50],
      ],
      attendance: [
        ['工号', '应出勤天数', '实出勤天数', '缺勤天数', '加班小时', '迟到分钟'],
        ['E011', 21.75, 21.75, 0, 0, 0],
      ],
      adjustments: [
        ['工号', '项目', '金额', '方向'],
        ['E011', '交通补贴', 200, '补贴'],
        ['E011', '交通补贴', 200, '补贴'],
      ],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    const codes = new Set(result.exceptions.map((e) => e.code));
    expect(codes.has('NON_ACTIVE_STILL_PAID') || codes.has('MISSING_BANK') || codes.has('MISSING_SALARY')).toBe(
      true,
    );
    expect(codes.has('MISSING_ATTENDANCE') || codes.has('HIRE_BOUNDARY') || codes.has('PAY_CHANGE_WARNING') || codes.has('DUPLICATE_ADJUSTMENT')).toBe(
      true,
    );
    expect(workbook!.SheetNames).toEqual([
      '工资明细',
      '银行发薪',
      '部门汇总',
      '异常待人工',
      '规则快照',
      '运行说明',
    ]);
  });

  it('writes readable XLSX with correct sheet names and control totals', async () => {
    const { result, workbook } = await runPayroll({
      employee: [
        ['工号', '姓名', '部门', '在职状态', '入职日期', '银行账号', '开户行'],
        ['E001', '张三', '研发', '在职', '2024-01-10', '62220001', '工行'],
        ['E002', '李四', '财务', '在职', '2023-05-01', '62220002', '建行'],
      ],
      salary: [
        ['工号', '基本工资', '时薪'],
        ['E001', 8700, 50],
        ['E002', 4350, 25],
      ],
      attendance: [
        ['工号', '应出勤天数', '实出勤天数', '缺勤天数', '加班小时', '迟到分钟'],
        ['E001', 21.75, 21.75, 0, 0, 0],
        ['E002', 21.75, 21.75, 0, 0, 0],
      ],
      socialTax: [
        ['工号', '个人社保', '个人公积金', '个税'],
        ['E001', 100, 50, 20],
        ['E002', 50, 25, 10],
      ],
    });
    expect(result.outputFiles[0]).toMatch(/本月工资核算_2026-07\.xlsx$/);
    expect(workbook!.SheetNames).toEqual([
      '工资明细',
      '银行发薪',
      '部门汇总',
      '异常待人工',
      '规则快照',
      '运行说明',
    ]);
    const detail = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['工资明细']!);
    const bank = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['银行发薪']!);
    const bankSum = bank.reduce((acc, row) => moneyAdd(acc, row.netPay), moneyAdd(0));
    expect(moneyToFixed(bankSum)).toBe(String(result.metrics.bankNetPayTotal));
    expect(result.metrics.bankNetPayTotal).toBe(
      moneyToFixed(
        detail
          .filter((r) => r.status === 'READY_TO_PAY')
          .reduce((acc, row) => moneyAdd(acc, row.netPay), moneyAdd(0)),
      ),
    );
    expect(detail.every((r) => r.sourceTrace)).toBe(true);
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
      const { result } = await runPayroll({
        employee: normalEmployee,
        salary: normalSalary,
        attendance: normalAttendance,
      });
      expect(fetchCount).toBe(0);
      const payload = JSON.stringify(result.aiSummaryPayload);
      expect(payload).not.toContain('张三');
      expect(payload).not.toContain('E001');
      expect(payload).not.toContain('62220001');
      expect(result.aiSummaryPayload?.rawRows).toBe(false);
      expect(result.metrics.autoPayment).toBe(false);
      expect(result.metrics.uploadedRawWorkbook).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('is deterministic across double runs', async () => {
    const input = {
      employee: normalEmployee,
      salary: normalSalary,
      attendance: normalAttendance,
      socialTax: [['工号', '个人社保', '个人公积金', '个税'], ['E001', 100, 50, 20]],
    };
    const a = await runPayroll(input);
    const b = await runPayroll(input);
    expect(a.result.metrics.netPayTotal).toBe(b.result.metrics.netPayTotal);
    expect(a.result.metrics.grossPayTotal).toBe(b.result.metrics.grossPayTotal);
    expect(a.result.metrics.readyToPayCount).toBe(b.result.metrics.readyToPayCount);
  });
});
