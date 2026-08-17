import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createFileRuleStore,
  createRuleStore,
  createWorkflowRuntime,
  toAttendanceRules,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

type RunOpts = {
  employee: unknown[][];
  schedule: unknown[][];
  punch: unknown[][];
  leave?: unknown[][];
  rules?: Record<string, unknown>;
  companyId?: string;
  persisted?: Record<string, unknown>;
  runDate?: string;
};

async function runAttendance(options: RunOpts) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-att-'));
  const empPath = join(dir, 'emp.xlsx');
  const schPath = join(dir, 'sch.xlsx');
  const punchPath = join(dir, 'punch.xlsx');
  writeSheet(empPath, options.employee);
  writeSheet(schPath, options.schedule);
  writeSheet(punchPath, options.punch);
  const inputFiles: Array<{ role: string; path: string }> = [
    { role: 'employee_master', path: empPath },
    { role: 'schedule', path: schPath },
    { role: 'punch', path: punchPath },
  ];
  if (options.leave) {
    const p = join(dir, 'leave.xlsx');
    writeSheet(p, options.leave);
    inputFiles.push({ role: 'leave', path: p });
  }

  const persistedRuleStore = createFileRuleStore({ rootDir: dir });
  if (options.companyId && options.persisted) {
    await persistedRuleStore.saveWorkflowRules(options.companyId, 'HR-ATTENDANCE-002', options.persisted);
  }
  const runtime = createWorkflowRuntime({ persistedRuleStore });
  const result = await runtime.execute({
    workflowId: 'HR-ATTENDANCE-002',
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
  ['工号', '姓名', '部门', '在职状态'],
  ['E001', '张三', '研发', '在职'],
];
const normalSchedule = [
  ['工号', '日期', '上班时间', '下班时间'],
  ['E001', '2026-07-01', '09:00', '18:00'],
];
const normalPunch = [
  ['工号', '打卡时间'],
  ['E001', '2026-07-01 09:00'],
  ['E001', '2026-07-01 18:00'],
];

describe('HR-ATTENDANCE-002', () => {
  it('normal case marks NORMAL attendance', async () => {
    const { result, workbook } = await runAttendance({
      employee: normalEmployee,
      schedule: normalSchedule,
      punch: normalPunch,
    });
    expect(result.errorMessage).toBeUndefined();
    expect(result.status).toBe('COMPLETED');
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['考勤明细']!);
    expect(rows[0]!.attendanceStatus).toBe('NORMAL');
    expect(rows[0]!.lateMinutes).toBe(0);
    expect(rows[0]!.sourceTrace).toBeTruthy();
  });

  it('supports Chinese field aliases', async () => {
    const { result, workbook } = await runAttendance({
      employee: [
        ['员工编号', '员工姓名', '部门', '员工状态'],
        ['E002', '李四', '财务', '正式'],
      ],
      schedule: [
        ['员工号', '班次日期', '班次开始', '班次结束'],
        ['E002', '2026-07-02', '09:00', '18:00'],
      ],
      punch: [
        ['工号', '打卡'],
        ['E002', '2026-07-02 09:10'],
        ['E002', '2026-07-02 18:00'],
      ],
      rules: { lateGraceMinutes: 0 },
    });
    expect(result.errorMessage).toBeUndefined();
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['考勤明细']!);
    expect(rows[0]!.employeeId).toBe('E002');
    expect(Number(rows[0]!.lateMinutes)).toBe(10);
  });

  it('fails on missing required role', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-att-miss-'));
    const empPath = join(dir, 'emp.xlsx');
    writeSheet(empPath, normalEmployee);
    const result = await createWorkflowRuntime().execute({
      workflowId: 'HR-ATTENDANCE-002',
      inputFiles: [{ role: 'employee_master', path: empPath }],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-15',
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toMatch(/Missing required input role/);
  });

  it('flags duplicate employees as NEEDS_REVIEW', async () => {
    const { result } = await runAttendance({
      employee: [
        ['工号', '姓名', '部门', '在职状态'],
        ['E001', '张三', '研发', '在职'],
        ['E001', '张三副本', '研发', '在职'],
      ],
      schedule: normalSchedule,
      punch: normalPunch,
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.some((e) => e.code === 'DUPLICATE_EMPLOYEE')).toBe(true);
  });

  it('applies rule defaults', () => {
    const defaults = createRuleStore().getDefaults('HR-ATTENDANCE-002');
    expect(defaults.lateGraceMinutes).toBe(5);
    expect(defaults['attendance.lateGraceMinutes']).toBe(5);
    expect(defaults.missingPunchRule).toBe('EXCEPTION');
    expect(defaults.overtimeMinimumMinutes).toBe(30);
    const rules = toAttendanceRules(defaults);
    expect(rules.lateGraceMinutes).toBe(5);
    expect(rules.maxWorkedMinutes).toBe(720);
  });

  it('loads company saved rules via createFileRuleStore', async () => {
    const { workbook } = await runAttendance({
      employee: normalEmployee,
      schedule: normalSchedule,
      punch: [
        ['工号', '打卡时间'],
        ['E001', '2026-07-01 09:08'],
        ['E001', '2026-07-01 18:00'],
      ],
      companyId: 'co-att',
      persisted: { lateGraceMinutes: 10 },
    });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['考勤明细']!);
    expect(Number(rows[0]!.lateMinutes)).toBe(0);
  });

  it('request.rules overrides persisted and defaults', async () => {
    const { workbook } = await runAttendance({
      employee: normalEmployee,
      schedule: normalSchedule,
      punch: [
        ['工号', '打卡时间'],
        ['E001', '2026-07-01 09:08'],
        ['E001', '2026-07-01 18:00'],
      ],
      companyId: 'co-att-2',
      persisted: { lateGraceMinutes: 10 },
      rules: { lateGraceMinutes: 0 },
    });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['考勤明细']!);
    expect(Number(rows[0]!.lateMinutes)).toBe(8);
  });

  it('classifies exceptions and sets NEEDS_REVIEW with leave conflict', async () => {
    const { result, workbook } = await runAttendance({
      employee: [
        ['工号', '姓名', '部门', '在职状态', '离职日期'],
        ['E010', '王五', '销售', '离职', '2026-06-01'],
      ],
      schedule: [
        ['工号', '日期', '上班时间', '下班时间'],
        ['E010', '2026-07-01', '09:00', '18:00'],
      ],
      punch: [
        ['工号', '打卡时间'],
        ['E010', '2026-07-01 09:00'],
        ['E010', '2026-07-01 09:00'],
      ],
      leave: [
        ['工号', '日期', '假别', '小时'],
        ['E010', '2026-07-01', '年假', 8],
      ],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    const codes = new Set(result.exceptions.map((e) => e.code));
    expect(
      codes.has('MISSING_OUT_PUNCH') ||
        codes.has('DUPLICATE_PUNCH') ||
        codes.has('LEAVE_ATTENDANCE_CONFLICT') ||
        codes.has('PUNCH_AFTER_TERMINATION'),
    ).toBe(true);
    expect(workbook!.SheetNames).toEqual([
      '考勤明细',
      '异常待确认',
      '加班统计',
      '缺卡清单',
      '请假冲突',
      '运行说明',
    ]);
  });

  it('writes readable XLSX with correct sheet names', async () => {
    const { result, workbook } = await runAttendance({
      employee: normalEmployee,
      schedule: [
        ['工号', '日期', '上班时间', '下班时间'],
        ['E001', '2026-07-01', '09:00', '18:00'],
        ['E001', '2026-07-02', '09:00', '18:00'],
      ],
      punch: [
        ['工号', '打卡时间'],
        ['E001', '2026-07-01 09:00'],
        ['E001', '2026-07-01 18:00'],
        ['E001', '2026-07-02 09:00'],
      ],
    });
    expect(result.outputFiles[0]).toMatch(/考勤异常_2026-07\.xlsx$/);
    expect(workbook!.SheetNames).toEqual([
      '考勤明细',
      '异常待确认',
      '加班统计',
      '缺卡清单',
      '请假冲突',
      '运行说明',
    ]);
    const notes = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['运行说明']!);
    expect(notes.some((r) => r.key === 'cloudUpload' && (r.value === false || r.value === 'false'))).toBe(true);
    const missing = XLSX.utils.sheet_to_json(workbook!.Sheets['缺卡清单']!);
    expect(missing.length).toBeGreaterThan(0);
  });

  it('fetch call count stays 0 and AI summary has no PII', async () => {
    let fetchCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return original(...args);
    }) as typeof fetch;
    try {
      const { result } = await runAttendance({
        employee: normalEmployee,
        schedule: normalSchedule,
        punch: normalPunch,
      });
      expect(fetchCount).toBe(0);
      const payload = JSON.stringify(result.aiSummaryPayload);
      expect(payload).not.toContain('张三');
      expect(payload).not.toContain('E001');
      expect(result.aiSummaryPayload?.rawRows).toBe(false);
      expect(result.metrics.cloudUpload).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('is deterministic across double runs', async () => {
    const input = {
      employee: normalEmployee,
      schedule: normalSchedule,
      punch: normalPunch,
    };
    const a = await runAttendance(input);
    const b = await runAttendance(input);
    expect(a.result.metrics.scheduleCount).toBe(b.result.metrics.scheduleCount);
    expect(a.result.metrics.exceptionCount).toBe(b.result.metrics.exceptionCount);
  });
});
