import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import {
  amountDiffExceeds,
  createRegionalSocialPolicyAdapter,
} from '../adapters/RegionalSocialPolicyAdapter.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  buildRuleSnapshotRows,
  detectDuplicateKeys,
  indexByEmployeeId,
  isActiveEmployment,
  normalizeEmploymentStatus,
} from '../operators/hrCommon.js';
import { moneyAdd, moneySub, moneyToFixed, toDecimal } from '../operators/money.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import { toSocialInsuranceRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const ID = ['工号', '员工编号', '员工号', 'employee_id', 'empId'];
const EMP_ALIASES: FieldAliasMap = {
  employeeId: ID,
  employeeName: ['姓名', '员工姓名', 'employee_name', 'name'],
  hireDate: ['入职日期', '入职日', 'hire_date'],
  terminationDate: ['离职日期', '离职日', 'termination_date'],
  employmentStatus: ['在职状态', '员工状态', 'employment_status', 'status'],
  department: ['部门', 'dept', 'department'],
};
const BASE_ALIASES: FieldAliasMap = {
  employeeId: ID,
  insuranceBase: ['社保基数', '保险基数', 'insurance_base', 'base'],
  fundBase: ['公积金基数', '住房基数', 'fund_base'],
};
const PAY_ALIASES: FieldAliasMap = {
  employeeId: ID,
  insuranceAmount: ['社保金额', '保险金额', 'insurance_amount'],
  fundAmount: ['公积金金额', '住房金额', 'fund_amount'],
  paymentMonth: ['缴费月', '所属月', 'payment_month', 'month'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function toYmd(value: unknown): string {
  const parsed = normalizeDate(value);
  return parsed.ok ? parsed.value : asText(value).slice(0, 10);
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

/** Thin orchestrator for HR-SOCIAL-INSURANCE-005. All money via Decimal. */
export async function executeHrSocialInsurance(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (
    !ctx.datasets.get('employee_master') ||
    !ctx.datasets.get('declared_base') ||
    !ctx.datasets.get('payment_detail')
  ) {
    throw new Error('employee_master, declared_base and payment_detail are required');
  }

  const rules = toSocialInsuranceRules(ctx.companyRules);
  const month = String(ctx.companyRules.month ?? ctx.runDate.slice(0, 7));
  const adapter = createRegionalSocialPolicyAdapter();
  const policy = adapter.getPolicy({ region: rules.region, month, rules });

  const employees = normRole(ctx, 'employee_master', EMP_ALIASES);
  const bases = normRole(ctx, 'declared_base', BASE_ALIASES);
  const payments = normRole(ctx, 'payment_detail', PAY_ALIASES).filter(
    (row) => !asText(row.paymentMonth) || asText(row.paymentMonth).slice(0, 7) === month,
  );

  const empById = indexByEmployeeId(employees);
  const baseById = indexByEmployeeId(bases);
  const payById = indexByEmployeeId(payments);
  const dupPay = detectDuplicateKeys(
    payments.map((row) => ({
      ...row,
      paymentMonth: asText(row.paymentMonth).slice(0, 7) || month,
    })),
    ['employeeId', 'paymentMonth'],
  );
  // Also treat >1 payment rows for same employee in month as duplicate
  for (const [employeeId, list] of payById) {
    if (list.length <= 1) continue;
    if (dupPay.some((d) => d.rows.some((r) => asText(r.employeeId) === employeeId))) continue;
    dupPay.push({
      key: `${employeeId.toLowerCase()}||${month}`,
      rows: list,
      count: list.length,
    });
  }

  const summary: DataRow[] = [];
  const missing: DataRow[] = [];
  const duplicates: DataRow[] = [];
  const baseAnomalies: DataRow[] = [];
  const amountDiffs: DataRow[] = [];
  const exceptionRows: DataRow[] = [];

  for (const dup of dupPay) {
    duplicates.push({
      employeeId: dup.rows[0]?.employeeId,
      paymentMonth: month,
      count: dup.count,
      sourceTrace: dup.rows.map(traceOf).join('|'),
    });
    ctx.exceptions.push({
      code: 'DUPLICATE_PAYMENT',
      severity: 'BLOCKING',
      message: '同月重复缴费',
      row: { employeeId: dup.rows[0]?.employeeId },
    });
    exceptionRows.push({
      employeeId: dup.rows[0]?.employeeId,
      code: 'DUPLICATE_PAYMENT',
      severity: 'BLOCKING',
      message: '同月重复缴费',
      sourceTrace: dup.rows.map(traceOf).join('|'),
    });
  }

  const employeeIds = new Set([
    ...employees.map((e) => asText(e.employeeId)),
    ...bases.map((b) => asText(b.employeeId)),
    ...payments.map((p) => asText(p.employeeId)),
  ]);

  for (const employeeId of [...employeeIds].filter(Boolean).sort()) {
    const emp = empById.get(employeeId)?.[0];
    const base = baseById.get(employeeId)?.[0];
    const pays = payById.get(employeeId) ?? [];
    const sourceTrace = [emp, base, ...pays].filter(Boolean).map((r) => traceOf(r!)).join('|');
    const note = (code: string, severity: 'INFO' | 'WARNING' | 'BLOCKING', message: string) => {
      ctx.exceptions.push({ code, severity, message, row: { employeeId } });
      exceptionRows.push({ employeeId, code, severity, message, sourceTrace });
    };

    const statusNorm = normalizeEmploymentStatus(emp?.employmentStatus);
    const hireDate = emp ? toYmd(emp.hireDate) : '';
    const termDate = emp ? toYmd(emp.terminationDate) : '';
    const shouldCover = adapter.shouldCoverMonth({
      hireDate,
      terminationDate: termDate,
      employmentStatus: statusNorm,
      month,
      policy,
    });

    if (!base || hasBlank(base.insuranceBase)) {
      note('MISSING_BASE', 'WARNING', '申报基数缺失');
    }

    const insuranceBase = toDecimal(base?.insuranceBase);
    const fundBase = toDecimal(base?.fundBase ?? base?.insuranceBase);
    if (base && (insuranceBase.lt(policy.minBase) || insuranceBase.gt(policy.maxBase))) {
      note('BASE_OUT_OF_RANGE', 'WARNING', '社保基数超上下限');
      baseAnomalies.push({
        employeeId,
        field: 'insuranceBase',
        value: moneyToFixed(insuranceBase, policy.roundingScale, policy.roundingMode),
        minBase: policy.minBase,
        maxBase: policy.maxBase,
        sourceTrace,
      });
    }
    if (base && (fundBase.lt(policy.minFundBase) || fundBase.gt(policy.maxFundBase))) {
      note('FUND_BASE_OUT_OF_RANGE', 'WARNING', '公积金基数超上下限');
      baseAnomalies.push({
        employeeId,
        field: 'fundBase',
        value: moneyToFixed(fundBase, policy.roundingScale, policy.roundingMode),
        minBase: policy.minFundBase,
        maxBase: policy.maxFundBase,
        sourceTrace,
      });
    }

    const expectedInsurance = adapter.expectedEmployeeInsurance(insuranceBase, policy);
    const expectedFund = adapter.expectedEmployeeFund(fundBase, policy);
    const actualInsurance = moneyToFixed(
      pays.reduce((acc, p) => moneyAdd(acc, p.insuranceAmount), moneyAdd(0)),
      policy.roundingScale,
      policy.roundingMode,
    );
    const actualFund = moneyToFixed(
      pays.reduce((acc, p) => moneyAdd(acc, p.fundAmount), moneyAdd(0)),
      policy.roundingScale,
      policy.roundingMode,
    );

    if (shouldCover && pays.length === 0 && isActiveEmployment(statusNorm)) {
      note('MISSING_PAYMENT', 'BLOCKING', '在职应缴但无缴费');
      missing.push({
        employeeId,
        employmentStatus: statusNorm,
        month,
        expectedInsurance,
        expectedFund,
        sourceTrace,
      });
    }
    if (!shouldCover && pays.length > 0) {
      note('UNEXPECTED_PAYMENT', 'WARNING', '不应缴费月份仍有缴费');
    }

    const insuranceVariance = moneyToFixed(
      moneySub(actualInsurance, expectedInsurance),
      policy.roundingScale,
      policy.roundingMode,
    );
    const fundVariance = moneyToFixed(
      moneySub(actualFund, expectedFund),
      policy.roundingScale,
      policy.roundingMode,
    );
    if (
      pays.length > 0 &&
      (amountDiffExceeds(actualInsurance, expectedInsurance, policy.amountTolerance) ||
        amountDiffExceeds(actualFund, expectedFund, policy.amountTolerance))
    ) {
      note('AMOUNT_MISMATCH', 'WARNING', '金额与配置费率不符');
      amountDiffs.push({
        employeeId,
        actualInsurance,
        expectedInsurance,
        insuranceVariance,
        actualFund,
        expectedFund,
        fundVariance,
        policyVersion: policy.version,
        sourceTrace,
      });
    }

    summary.push({
      employeeId,
      employeeName: emp?.employeeName ?? '',
      employmentStatus: statusNorm,
      hireDate,
      terminationDate: termDate,
      shouldCover,
      insuranceBase: moneyToFixed(insuranceBase, policy.roundingScale, policy.roundingMode),
      fundBase: moneyToFixed(fundBase, policy.roundingScale, policy.roundingMode),
      expectedInsurance,
      expectedFund,
      actualInsurance,
      actualFund,
      insuranceVariance,
      fundVariance,
      paymentCount: pays.length,
      policyVersion: policy.version,
      region: policy.region,
      status:
        pays.length === 0 && shouldCover
          ? 'MISSING'
          : amountDiffExceeds(actualInsurance, expectedInsurance, policy.amountTolerance) ||
              amountDiffExceeds(actualFund, expectedFund, policy.amountTolerance)
            ? 'MISMATCH'
            : 'OK',
      sourceTrace,
    });
  }

  const ruleVersionRows = buildRuleSnapshotRows(policy as unknown as Record<string, unknown>, {
    month,
    network: false,
  });
  const runNotes = buildHrRunNotes({
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    runDate: ctx.runDate,
    rules: rules as unknown as Record<string, unknown>,
    inputSha256ByRole: ctx.inputSha256ByRole,
    inputRowCount: employees.length,
    outputRowCount: summary.length,
    exceptionCount: exceptionRows.length,
    extras: [
      { key: 'month', value: month },
      { key: 'policyVersion', value: policy.version },
      { key: 'region', value: policy.region },
    ],
  });

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '社保公积金核对_{month}.xlsx',
    { month, runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '核对总表', rows: summary },
      { name: '漏缴清单', rows: missing },
      { name: '重复缴费', rows: duplicates },
      { name: '基数异常', rows: baseAnomalies },
      { name: '金额差异', rows: amountDiffs },
      { name: '规则版本', rows: ruleVersionRows },
      { name: '运行说明', rows: runNotes },
    ],
  });

  ctx.metrics = {
    employeeCount: summary.length,
    missingCount: missing.length,
    duplicateCount: duplicates.length,
    baseAnomalyCount: baseAnomalies.length,
    amountDiffCount: amountDiffs.length,
    exceptionCount: exceptionRows.length,
    policyVersion: policy.version,
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
        employeeCount: summary.length,
        missingCount: missing.length,
        duplicateCount: duplicates.length,
        baseAnomalyCount: baseAnomalies.length,
        amountDiffCount: amountDiffs.length,
        exceptionCount: exceptionRows.length,
        policyVersion: policy.version,
        exceptionByCode: aggregateExceptionCounts(ctx.exceptions).map((e) => ({
          code: e.code,
          count: e.count,
          severity: e.severity,
        })),
      },
      note: 'Aggregates only; policy from config; no network.',
    },
  };
}
