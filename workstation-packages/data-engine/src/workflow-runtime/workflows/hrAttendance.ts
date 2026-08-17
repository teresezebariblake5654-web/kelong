import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  calcEarlyLeaveMinutes,
  calcLateMinutes,
  calcWorkedMinutes,
  classifyAttendanceException,
  isCrossDayShift,
  pairPunchesForShift,
  parseClockToMinutes,
  type AttendanceRules,
} from '../operators/attendanceOps.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  detectDuplicateKeys,
  indexByEmployeeId,
  normalizeEmploymentStatus,
} from '../operators/hrCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import { toAttendanceRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const ID = ['工号', '员工编号', '员工号', 'employee_id', 'empId'];
const EMP_ALIASES: FieldAliasMap = {
  employeeId: ID,
  employeeName: ['姓名', '员工姓名', 'employee_name', 'name'],
  employmentStatus: ['在职状态', '员工状态', 'employment_status', 'status'],
  terminationDate: ['离职日期', '离职日', 'termination_date'],
  department: ['部门', 'dept', 'department'],
};
const SCHEDULE_ALIASES: FieldAliasMap = {
  employeeId: ID,
  date: ['日期', '班次日期', 'work_date', 'schedule_date'],
  shiftStart: ['上班时间', '班次开始', 'shift_start', 'start'],
  shiftEnd: ['下班时间', '班次结束', 'shift_end', 'end'],
  breakMinutes: ['休息分钟', '休息时长', 'break_minutes'],
};
const PUNCH_ALIASES: FieldAliasMap = {
  employeeId: ID,
  punchTime: ['打卡时间', '打卡', 'punch_time', 'clock_time'],
};
const LEAVE_ALIASES: FieldAliasMap = {
  employeeId: ID,
  date: ['日期', '请假日期', 'leave_date'],
  leaveType: ['假别', '请假类型', 'leave_type', 'type'],
  hours: ['小时', '请假小时', 'leave_hours', 'hours'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function toYmd(value: unknown): string {
  const parsed = normalizeDate(value);
  if (parsed.ok) return parsed.value;
  const text = asText(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (text.includes(' ')) return text.split(/\s+/)[0] ?? '';
  return text.slice(0, 10);
}

function punchDate(punchTime: unknown): string {
  const text = asText(punchTime);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = normalizeDate(punchTime);
  return parsed.ok ? parsed.value : toYmd(punchTime);
}

function scheduledMinutes(shiftStart: unknown, shiftEnd: unknown, crossDay: boolean): number {
  const start = parseClockToMinutes(shiftStart);
  const end = parseClockToMinutes(shiftEnd);
  if (start === null || end === null) return 0;
  if (!crossDay) return Math.max(end - start, 0);
  return end < start ? end + 1440 - start : end - start;
}

function normRole(ctx: OperatorContext, role: string, aliases: FieldAliasMap): DataRow[] {
  const ds = ctx.datasets.get(role);
  if (!ds) return [];
  return normalizeColumns(ds.rows, aliases, {
    role,
    sourceFile: ds.fileName,
    sourceSheet: ds.sheetName,
    inputSha256: ds.sha256,
  });
}

/** Thin orchestrator for HR-ATTENDANCE-002. */
export async function executeHrAttendance(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('employee_master') || !ctx.datasets.get('schedule') || !ctx.datasets.get('punch')) {
    throw new Error('employee_master, schedule and punch are required');
  }

  const rules: AttendanceRules = toAttendanceRules(ctx.companyRules);
  const month = String(ctx.companyRules.month ?? ctx.runDate.slice(0, 7));
  const employees = normRole(ctx, 'employee_master', EMP_ALIASES);
  const schedules = normRole(ctx, 'schedule', SCHEDULE_ALIASES);
  const punches = normRole(ctx, 'punch', PUNCH_ALIASES);
  const leaves = normRole(ctx, 'leave', LEAVE_ALIASES);

  const empById = indexByEmployeeId(employees);
  const dupEmployees = new Set(detectDuplicateKeys(employees, ['employeeId']).map((d) => d.key));
  const leaveKeys = new Set(
    leaves.map((row) => `${asText(row.employeeId).toLowerCase()}||${toYmd(row.date)}`),
  );
  const punchesByEmpDate = new Map<string, Array<{ punchTime: unknown; raw: DataRow }>>();
  for (const punch of punches) {
    const id = asText(punch.employeeId);
    const date = punchDate(punch.punchTime);
    if (!id || !date) continue;
    const key = `${id.toLowerCase()}||${date}`;
    const list = punchesByEmpDate.get(key) ?? [];
    list.push({ punchTime: punch.punchTime, raw: punch });
    punchesByEmpDate.set(key, list);
  }

  const detail: DataRow[] = [];
  const exceptionRows: DataRow[] = [];
  const overtimeRows: DataRow[] = [];
  const missingPunchRows: DataRow[] = [];
  const leaveConflictRows: DataRow[] = [];

  for (const schedule of schedules) {
    const employeeId = asText(schedule.employeeId);
    const date = toYmd(schedule.date);
    const emp = empById.get(employeeId)?.[0];
    const employeeName = asText(emp?.employeeName ?? '');
    const sourceTrace = traceOf(schedule);
    const codes: string[] = [];
    const note = (code: string, severity: 'INFO' | 'WARNING' | 'BLOCKING', message: string) => {
      codes.push(code);
      ctx.exceptions.push({ code, severity, message, row: { employeeId, date } });
      exceptionRows.push({
        employeeId,
        employeeName,
        date,
        code,
        severity,
        message,
        sourceTrace,
      });
    };

    if (!employeeId || !date || hasBlank(schedule.shiftStart) || hasBlank(schedule.shiftEnd)) {
      note('MISSING_REQUIRED_FIELD', 'BLOCKING', '排班必填字段缺失');
    }
    if (employeeId && dupEmployees.has(employeeId.toLowerCase())) {
      note('DUPLICATE_EMPLOYEE', 'BLOCKING', '员工工号重复');
    }
    if (!emp) note('MISSING_EMPLOYEE', 'WARNING', '员工主数据缺失');

    const key = `${employeeId.toLowerCase()}||${date}`;
    const dayPunches = punchesByEmpDate.get(key) ?? [];
    const crossDay = isCrossDayShift(schedule.shiftStart, schedule.shiftEnd);
    const paired = pairPunchesForShift({
      punches: dayPunches,
      shiftStart: schedule.shiftStart,
      shiftEnd: schedule.shiftEnd,
    });
    const breakMinutes = Number(schedule.breakMinutes ?? rules.breakMinutesDefault);
    const lateMinutes = calcLateMinutes({
      actualIn: paired.actualIn,
      shiftStart: schedule.shiftStart,
      graceMinutes: rules.lateGraceMinutes,
    });
    const earlyLeaveMinutes = calcEarlyLeaveMinutes({
      actualOut: paired.actualOut,
      shiftStart: schedule.shiftStart,
      shiftEnd: schedule.shiftEnd,
      graceMinutes: rules.earlyLeaveGraceMinutes,
      crossDay,
    });
    const workedMinutes = calcWorkedMinutes({
      actualIn: paired.actualIn,
      actualOut: paired.actualOut,
      breakMinutes,
      crossDay,
    });
    const scheduled = scheduledMinutes(schedule.shiftStart, schedule.shiftEnd, crossDay);
    const overtimeMinutes = Math.max(workedMinutes - Math.max(scheduled - breakMinutes, 0), 0);
    const leaveConflict = leaveKeys.has(key) && (paired.actualIn != null || paired.actualOut != null);
    const term = emp ? toYmd(emp.terminationDate) : '';
    const punchedAfterTermination = Boolean(term && date > term && dayPunches.length > 0);

    const classified = classifyAttendanceException({
      hasSchedule: Boolean(employeeId && date && !hasBlank(schedule.shiftStart)),
      actualIn: paired.actualIn,
      actualOut: paired.actualOut,
      lateMinutes,
      earlyLeaveMinutes,
      workedMinutes,
      duplicatePunch: paired.duplicatePunch,
      unpairedCrossDay: paired.unpairedCrossDay,
      leaveConflict,
      punchedAfterTermination,
      rules,
    });

    for (const code of classified) {
      if (codes.includes(code)) continue;
      const severity: 'INFO' | 'WARNING' | 'BLOCKING' =
        code === 'ABSENT' || code === 'MISSING_SCHEDULE' || code === 'PUNCH_AFTER_TERMINATION'
          ? 'BLOCKING'
          : 'WARNING';
      note(code, severity, code);
    }

    const attendanceStatus =
      classified.includes('ABSENT')
        ? 'ABSENT'
        : classified.some((c) => c.startsWith('MISSING_'))
          ? 'MISSING_PUNCH'
          : classified.includes('LATE') || classified.includes('EARLY_LEAVE')
            ? 'EXCEPTION'
            : classified.length > 0
              ? 'EXCEPTION'
              : 'NORMAL';

    const row: DataRow = {
      employeeId,
      employeeName,
      department: emp?.department ?? '',
      employmentStatus: normalizeEmploymentStatus(emp?.employmentStatus),
      date,
      shiftStart: schedule.shiftStart,
      shiftEnd: schedule.shiftEnd,
      actualIn: paired.actualIn ?? '',
      actualOut: paired.actualOut ?? '',
      lateMinutes,
      earlyLeaveMinutes,
      workedMinutes,
      overtimeMinutes: overtimeMinutes >= rules.overtimeMinimumMinutes ? overtimeMinutes : 0,
      attendanceStatus,
      exceptionCodes: classified.join('|'),
      sourceTrace,
    };
    detail.push(row);

    if (Number(row.overtimeMinutes) > 0) {
      overtimeRows.push({
        employeeId,
        employeeName,
        date,
        overtimeMinutes: row.overtimeMinutes,
        workedMinutes,
        sourceTrace,
      });
    }
    if (classified.includes('MISSING_IN_PUNCH') || classified.includes('MISSING_OUT_PUNCH')) {
      missingPunchRows.push({
        employeeId,
        employeeName,
        date,
        missingIn: !paired.actualIn,
        missingOut: Boolean(paired.actualIn && !paired.actualOut),
        sourceTrace,
      });
    }
    if (leaveConflict) {
      leaveConflictRows.push({
        employeeId,
        employeeName,
        date,
        leaveType: leaves.find((l) => `${asText(l.employeeId).toLowerCase()}||${toYmd(l.date)}` === key)
          ?.leaveType,
        actualIn: paired.actualIn ?? '',
        actualOut: paired.actualOut ?? '',
        sourceTrace,
      });
    }
  }

  const runNotes = buildHrRunNotes({
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    runDate: ctx.runDate,
    rules: rules as unknown as Record<string, unknown>,
    inputSha256ByRole: ctx.inputSha256ByRole,
    inputRowCount: schedules.length,
    outputRowCount: detail.length,
    exceptionCount: exceptionRows.length,
    extras: [{ key: 'month', value: month }],
  });

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '考勤异常_{month}.xlsx',
    { month, runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '考勤明细', rows: detail },
      { name: '异常待确认', rows: exceptionRows },
      { name: '加班统计', rows: overtimeRows },
      { name: '缺卡清单', rows: missingPunchRows },
      { name: '请假冲突', rows: leaveConflictRows },
      { name: '运行说明', rows: runNotes },
    ],
  });

  ctx.metrics = {
    scheduleCount: detail.length,
    exceptionCount: exceptionRows.length,
    overtimeCount: overtimeRows.length,
    missingPunchCount: missingPunchRows.length,
    leaveConflictCount: leaveConflictRows.length,
    localExecution: true,
    cloudUpload: false,
    uploadedRawWorkbook: false,
  };

  return {
    runId: ctx.runId,
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    status: exceptionRows.length > 0 ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath],
    metrics: ctx.metrics,
    exceptions: aggregateExceptionCounts(ctx.exceptions),
    aiSummaryPayload: {
      workflowId: definition.id,
      workflowVersion: ctx.workflowVersion,
      runId: ctx.runId,
      rawRows: false,
      containsPii: false,
      metrics: {
        scheduleCount: detail.length,
        exceptionCount: exceptionRows.length,
        overtimeCount: overtimeRows.length,
        missingPunchCount: missingPunchRows.length,
        leaveConflictCount: leaveConflictRows.length,
        exceptionByCode: aggregateExceptionCounts(ctx.exceptions).map((e) => ({
          code: e.code,
          count: e.count,
          severity: e.severity,
        })),
      },
      note: 'Aggregates only; no employeeName/employeeId.',
    },
  };
}
