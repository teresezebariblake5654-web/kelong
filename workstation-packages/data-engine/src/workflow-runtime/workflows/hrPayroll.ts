import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import {
  createDefaultPayrollPolicyAdapter,
  roundPayrollAmount,
  type PayrollRules,
} from '../adapters/PayrollPolicyAdapter.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  buildRuleSnapshotRows,
  controlTotal,
  detectDuplicateKeys,
  indexByEmployeeId,
  isActiveEmployment,
  normalizeEmploymentStatus,
} from '../operators/hrCommon.js';
import { moneyAdd, moneyDiv, moneySub, moneyToFixed, toDecimal } from '../operators/money.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import { toPayrollRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const ID = ['工号', '员工编号', '员工号', 'employee_id', 'empId'];
const EMP_ALIASES: FieldAliasMap = {
  employeeId: ID,
  employeeName: ['姓名', '员工姓名', 'employee_name', 'name'],
  department: ['部门', 'dept', 'department'],
  employmentStatus: ['在职状态', '员工状态', 'employment_status', 'status'],
  hireDate: ['入职日期', '入职日', 'hire_date'],
  terminationDate: ['离职日期', '离职日', 'termination_date'],
  bankAccount: ['银行账号', '银行卡号', '账号', 'bank_account'],
  bankName: ['开户行', '银行', 'bank_name'],
  position: ['岗位', '职位', 'position'],
  previousNetPay: ['上月实发', '上期实发', 'previous_net_pay'],
};
const SALARY_ALIASES: FieldAliasMap = {
  employeeId: ID,
  baseSalary: ['基本工资', '底薪', 'base_salary', '薪资'],
  positionSalary: ['岗位工资', '职位工资', 'position_salary'],
  performanceSalary: ['绩效工资', 'performance_salary'],
  hourlySalary: ['时薪', '小时工资', 'hourly_salary'],
  overtimeBase: ['加班基数', 'overtime_base'],
  previousNetPay: ['上月实发', '上期实发', 'previous_net_pay'],
};
const ATT_ALIASES: FieldAliasMap = {
  employeeId: ID,
  payableDays: ['应出勤天数', '应付天数', 'payable_days'],
  workDays: ['工作天数', '应出勤', 'work_days'],
  attendedDays: ['实出勤天数', '出勤天数', 'attended_days'],
  absenceDays: ['缺勤天数', '旷工天数', 'absence_days'],
  overtimeHours: ['加班小时', '加班时长', 'overtime_hours'],
  lateMinutes: ['迟到分钟', '迟到时长', 'late_minutes'],
};
const ADJ_ALIASES: FieldAliasMap = {
  employeeId: ID,
  itemName: ['项目', '调整项', 'item_name', '科目'],
  amount: ['金额', 'amount'],
  direction: ['方向', '加减', 'direction', '类型'],
};
const TAX_ALIASES: FieldAliasMap = {
  employeeId: ID,
  employeeSocial: ['个人社保', '社保个人', 'employee_social'],
  employeeFund: ['个人公积金', '公积金个人', 'employee_fund'],
  personalTax: ['个税', '个人所得税', 'personal_tax'],
};

type Exc = { code: string; severity: 'INFO' | 'WARNING' | 'BLOCKING'; message: string };

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function isCredit(raw: unknown): boolean {
  const t = asText(raw);
  const u = t.toUpperCase();
  return u === 'IN' || u === 'ALLOWANCE' || u === 'BONUS' || u === '+' || u === 'CREDIT' || /补贴|奖金|加项/.test(t);
}

function inPayMonth(dateRaw: unknown, payMonth: string): boolean {
  const parsed = normalizeDate(dateRaw);
  return parsed.ok && parsed.value.slice(0, 7) === payMonth;
}

function normRole(
  ctx: OperatorContext,
  role: string,
  aliases: FieldAliasMap,
): DataRow[] {
  const ds = ctx.datasets.get(role);
  if (!ds) return [];
  return normalizeColumns(ds.rows, aliases, {
    role,
    sourceFile: ds.fileName,
    sourceSheet: ds.sheetName,
    inputSha256: ds.sha256,
  });
}

function aggregateAdjustments(rows: DataRow[]) {
  const byEmp = new Map<string, { allowance: ReturnType<typeof toDecimal>; deduction: ReturnType<typeof toDecimal>; dupItems: string[] }>();
  const itemCounts = new Map<string, number>();
  for (const row of rows) {
    const id = asText(row.employeeId);
    if (!id) continue;
    const itemKey = `${id}||${asText(row.itemName).toLowerCase()}`;
    itemCounts.set(itemKey, (itemCounts.get(itemKey) ?? 0) + 1);
    const bucket = byEmp.get(id) ?? { allowance: toDecimal(0), deduction: toDecimal(0), dupItems: [] };
    if (isCredit(row.direction)) bucket.allowance = moneyAdd(bucket.allowance, row.amount);
    else bucket.deduction = moneyAdd(bucket.deduction, row.amount);
    byEmp.set(id, bucket);
  }
  for (const [key, count] of itemCounts) {
    if (count <= 1) continue;
    const [id, item] = key.split('||');
    byEmp.get(id!)?.dupItems.push(item || '');
  }
  return byEmp;
}

/** Thin orchestrator for HR-PAYROLL-001. Bank sheet is export-only — never triggers payment. */
export async function executeHrPayroll(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('employee_master') || !ctx.datasets.get('salary_standard') || !ctx.datasets.get('attendance_summary')) {
    throw new Error('employee_master, salary_standard and attendance_summary are required');
  }

  const policy: PayrollRules = toPayrollRules(ctx.companyRules);
  const adapter = createDefaultPayrollPolicyAdapter();
  const payMonth = String(ctx.companyRules.payMonth ?? ctx.runDate.slice(0, 7));
  const employees = normRole(ctx, 'employee_master', EMP_ALIASES);
  const salaries = normRole(ctx, 'salary_standard', SALARY_ALIASES);
  const attendance = normRole(ctx, 'attendance_summary', ATT_ALIASES);
  const adjustments = normRole(ctx, 'adjustments', ADJ_ALIASES);
  const socialTax = normRole(ctx, 'social_tax', TAX_ALIASES);

  const dupEmployees = new Set(detectDuplicateKeys(employees, ['employeeId']).map((d) => d.key));
  const salaryById = indexByEmployeeId(salaries);
  const attById = indexByEmployeeId(attendance);
  const taxById = indexByEmployeeId(socialTax);
  const adjByEmp = aggregateAdjustments(adjustments);
  const bankCounts = new Map<string, number>();
  for (const row of employees) {
    const acct = asText(row.bankAccount);
    if (acct) bankCounts.set(acct, (bankCounts.get(acct) ?? 0) + 1);
  }

  const detail: DataRow[] = [];
  const exceptionRows: DataRow[] = [];
  const pushExc = (employeeId: string, employeeName: string, list: Exc[], ex: Exc, sourceTrace: string) => {
    list.push(ex);
    ctx.exceptions.push({ ...ex, row: { employeeId } });
    exceptionRows.push({ employeeId, employeeName, code: ex.code, severity: ex.severity, message: ex.message, sourceTrace });
  };

  for (const emp of employees) {
    const employeeId = asText(emp.employeeId);
    const employeeName = asText(emp.employeeName);
    const sourceTrace = traceOf(emp);
    const excs: Exc[] = [];
    const note = (code: string, severity: Exc['severity'], message: string) =>
      pushExc(employeeId || '(blank)', employeeName, excs, { code, severity, message }, sourceTrace);

    if (!employeeId || hasBlank(emp.employeeName) || hasBlank(emp.department) || hasBlank(emp.employmentStatus)) {
      note('MISSING_REQUIRED_FIELD', 'BLOCKING', '员工主数据必填字段缺失');
    }
    if (employeeId && dupEmployees.has(employeeId.toLowerCase())) note('DUPLICATE_EMPLOYEE', 'BLOCKING', '员工工号重复');
    const salary = salaryById.get(employeeId)?.[0];
    const att = attById.get(employeeId)?.[0];
    const tax = taxById.get(employeeId)?.[0];
    const adj = adjByEmp.get(employeeId);
    if (!salary || hasBlank(salary.baseSalary)) note('MISSING_SALARY', 'BLOCKING', '薪资标准缺失');
    if (!att) note('MISSING_ATTENDANCE', 'BLOCKING', '考勤整月缺失');
    const statusNorm = normalizeEmploymentStatus(emp.employmentStatus);
    if (!isActiveEmployment(emp.employmentStatus)) note('NON_ACTIVE_STILL_PAID', 'BLOCKING', `非在职状态仍核算: ${statusNorm}`);
    if (inPayMonth(emp.hireDate, payMonth)) note('HIRE_BOUNDARY', 'WARNING', '入职当月边界');
    if (inPayMonth(emp.terminationDate, payMonth)) note('TERM_BOUNDARY', 'WARNING', '离职当月边界');
    if (hasBlank(emp.bankAccount)) note('MISSING_BANK', 'BLOCKING', '银行卡缺失');
    else if ((bankCounts.get(asText(emp.bankAccount)) ?? 0) > 1) note('DUPLICATE_BANK', 'WARNING', '银行卡号与他人重复');
    if (adj?.dupItems.length) note('DUPLICATE_ADJUSTMENT', 'WARNING', `调整项重复: ${adj.dupItems.join(',')}`);

    const baseSalary = toDecimal(salary?.baseSalary);
    const dailySalary = moneyDiv(baseSalary, policy.standardPayableDays);
    const absenceDays = toDecimal(att?.absenceDays);
    const lateMinutes = toDecimal(att?.lateMinutes);
    const overtimeHours = toDecimal(att?.overtimeHours);
    const hourly =
      !hasBlank(salary?.hourlySalary) && !toDecimal(salary?.hourlySalary).isZero()
        ? salary!.hourlySalary
        : !hasBlank(salary?.overtimeBase)
          ? salary!.overtimeBase
          : moneyDiv(dailySalary, 8);
    const absenceDeduction = adapter.calcAbsenceDeduction({ absenceDays, dailySalary, rules: policy });
    const lateDeduction = adapter.calcLateDeduction({ lateMinutes, rules: policy });
    const overtimePay = adapter.calcOvertimePay({
      overtimeHours,
      hourlySalary: hourly,
      overtimeBase: salary?.overtimeBase,
      rules: policy,
    });
    const allowances = moneyAdd(adj?.allowance ?? 0);
    const otherDeduction = moneyAdd(adj?.deduction ?? 0);
    const employeeSocial = toDecimal(tax?.employeeSocial);
    const employeeFund = toDecimal(tax?.employeeFund);
    const personalTax = toDecimal(tax?.personalTax);
    const grossPay = moneyAdd(baseSalary, salary?.positionSalary, salary?.performanceSalary, overtimePay, allowances, 0);
    const totalDeduction = moneyAdd(absenceDeduction, lateDeduction, otherDeduction, employeeSocial, employeeFund, personalTax);
    const grossFixed = roundPayrollAmount(grossPay, policy);
    const dedFixed = roundPayrollAmount(totalDeduction, policy);
    const netPay = roundPayrollAmount(moneySub(grossFixed, dedFixed), policy);
    const rebuilt = moneyToFixed(moneySub(grossPay, totalDeduction), policy.roundingScale, policy.roundingMode);
    if (toDecimal(rebuilt).minus(toDecimal(netPay)).abs().gt('0.02')) {
      note('FORMULA_IMBALANCE', 'BLOCKING', '金额公式不平');
    }
    if (toDecimal(netPay).isNegative()) {
      note('NEGATIVE_NET_PAY', policy.negativeNetPayBlocked ? 'BLOCKING' : 'WARNING', '负工资');
    }
    const prev = emp.previousNetPay ?? salary?.previousNetPay;
    if (!hasBlank(prev) && !toDecimal(prev).isZero()) {
      if (moneyDiv(moneySub(netPay, prev).abs(), prev).gt(policy.payrollChangeWarningRate)) {
        note('PAY_CHANGE_WARNING', 'WARNING', `净工资环比变化超过 ${policy.payrollChangeWarningRate}`);
      }
    }

    const rowStatus = excs.some((e) => e.severity === 'BLOCKING') ? 'NEEDS_REVIEW' : 'READY_TO_PAY';
    detail.push({
      employeeId,
      employeeName,
      department: emp.department,
      employmentStatus: statusNorm,
      bankAccount: emp.bankAccount,
      bankName: emp.bankName,
      payableDays: att?.payableDays ?? att?.workDays ?? policy.standardPayableDays,
      attendedDays: att?.attendedDays ?? '',
      absenceDays: moneyToFixed(absenceDays, policy.roundingScale, policy.roundingMode),
      overtimeHours: moneyToFixed(overtimeHours, policy.roundingScale, policy.roundingMode),
      lateMinutes: moneyToFixed(lateMinutes, 0),
      baseSalary: roundPayrollAmount(baseSalary, policy),
      dailySalary: roundPayrollAmount(dailySalary, policy),
      overtimePay,
      absenceDeduction,
      lateDeduction,
      allowances: roundPayrollAmount(allowances, policy),
      otherDeduction: roundPayrollAmount(otherDeduction, policy),
      employeeSocial: roundPayrollAmount(employeeSocial, policy),
      employeeFund: roundPayrollAmount(employeeFund, policy),
      personalTax: roundPayrollAmount(personalTax, policy),
      grossPay: grossFixed,
      totalDeduction: dedFixed,
      netPay,
      status: rowStatus,
      exceptionCodes: excs.map((e) => e.code).join('|'),
      sourceTrace,
    });
  }

  const bank = detail
    .filter((row) => asText(row.status) === 'READY_TO_PAY')
    .map((row) => ({
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      bankName: row.bankName,
      bankAccount: row.bankAccount,
      netPay: row.netPay,
      sourceTrace: row.sourceTrace,
    }));

  const deptMap = new Map<string, { count: number; gross: ReturnType<typeof toDecimal>; net: ReturnType<typeof toDecimal> }>();
  for (const row of detail) {
    const dept = asText(row.department) || '(空白)';
    const prev = deptMap.get(dept) ?? { count: 0, gross: toDecimal(0), net: toDecimal(0) };
    prev.count += 1;
    prev.gross = moneyAdd(prev.gross, row.grossPay);
    prev.net = moneyAdd(prev.net, row.netPay);
    deptMap.set(dept, prev);
  }
  const deptSummary: DataRow[] = [...deptMap.entries()].map(([department, v]) => ({
    department,
    employeeCount: v.count,
    grossPayTotal: roundPayrollAmount(v.gross, policy),
    netPayTotal: roundPayrollAmount(v.net, policy),
  }));

  const netReadyTotal = controlTotal(bank, 'netPay');
  const netAllTotal = controlTotal(detail, 'netPay');
  const grossAllTotal = controlTotal(detail, 'grossPay');
  const ruleSnapshot = buildRuleSnapshotRows(policy as unknown as Record<string, unknown>, {
    payMonth,
    bankExportOnly: true,
    autoPayment: false,
  });
  const runNotes = buildHrRunNotes({
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    runDate: ctx.runDate,
    rules: policy as unknown as Record<string, unknown>,
    inputSha256ByRole: ctx.inputSha256ByRole,
    inputRowCount: employees.length,
    outputRowCount: detail.length,
    exceptionCount: exceptionRows.length,
    extras: [
      { key: 'payMonth', value: payMonth },
      { key: 'control.grossPayTotal', value: grossAllTotal },
      { key: 'control.netPayTotal', value: netAllTotal },
      { key: 'control.bankNetPayTotal', value: netReadyTotal },
      { key: 'autoPayment', value: false },
    ],
  });

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '本月工资核算_{payMonth}.xlsx',
    { payMonth, runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '工资明细', rows: detail },
      { name: '银行发薪', rows: bank },
      { name: '部门汇总', rows: deptSummary },
      { name: '异常待人工', rows: exceptionRows },
      { name: '规则快照', rows: ruleSnapshot },
      { name: '运行说明', rows: runNotes },
    ],
  });

  ctx.metrics = {
    employeeCount: detail.length,
    readyToPayCount: bank.length,
    exceptionCount: exceptionRows.length,
    grossPayTotal: grossAllTotal,
    netPayTotal: netAllTotal,
    bankNetPayTotal: netReadyTotal,
    localExecution: true,
    uploadedRawWorkbook: false,
    autoPayment: false,
    cloudUpload: false,
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
        employeeCount: detail.length,
        readyToPayCount: bank.length,
        exceptionCount: exceptionRows.length,
        grossPayTotal: grossAllTotal,
        netPayTotal: netAllTotal,
        bankNetPayTotal: netReadyTotal,
        exceptionByCode: aggregateExceptionCounts(ctx.exceptions).map((e) => ({
          code: e.code,
          count: e.count,
          severity: e.severity,
        })),
      },
      note: 'Aggregates only; no employeeName/employeeId/bankAccount.',
    },
  };
}
