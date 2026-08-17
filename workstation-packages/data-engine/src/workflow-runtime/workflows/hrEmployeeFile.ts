import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  detectDuplicateKeys,
  hashSensitive,
  maskSensitiveValue,
} from '../operators/hrCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import { daysBetween } from '../operators/dateWindow.js';
import { toEmployeeFileRules, type EmployeeFileRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const ID = ['工号', '员工编号', '员工号', 'employee_id', 'empId'];
const ALIASES: FieldAliasMap = {
  employeeId: ID,
  employeeName: ['姓名', '员工姓名', 'employee_name', 'name'],
  department: ['部门', 'dept', 'department'],
  hireDate: ['入职日期', '入职日', 'hire_date'],
  employmentStatus: ['在职状态', '员工状态', 'employment_status', 'status'],
  phone: ['手机', '手机号', '电话', 'phone', 'mobile'],
  idNumber: ['身份证', '身份证号', '证件号', 'id_number', 'idNumber'],
  bankAccount: ['银行账号', '银行卡号', 'bank_account'],
  email: ['邮箱', 'email'],
  contractExpiry: ['合同到期', '合同到期日', 'contract_expiry', 'contractEnd'],
  licenseExpiry: ['证照到期', '证照到期日', 'license_expiry', 'certExpiry'],
  idCard: ['身份证附件', '身份证资料', 'id_card_doc'],
  contract: ['合同附件', '劳动合同', 'contract_doc'],
  position: ['岗位', '职位', 'position'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function toYmd(value: unknown): string {
  const parsed = normalizeDate(value);
  return parsed.ok ? parsed.value : asText(value).slice(0, 10);
}

function pickLatestNonEmpty(rows: DataRow[], field: string): { value: unknown; source: string } {
  let value: unknown = '';
  let source = '';
  for (const row of rows) {
    if (!hasBlank(row[field])) {
      value = row[field];
      source = traceOf(row);
    }
  }
  return { value, source };
}

function conflictFields(rows: DataRow[], fields: string[]): string[] {
  const conflicts: string[] = [];
  for (const field of fields) {
    const values = new Set(
      rows.map((r) => asText(r[field])).filter(Boolean).map((v) => v.toLowerCase()),
    );
    if (values.size > 1) conflicts.push(field);
  }
  return conflicts;
}

/** Thin orchestrator for HR-EMPLOYEE-FILE-003. Conflicts are logged, never auto-overwritten. */
export async function executeHrEmployeeFile(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('employee_files')) {
    throw new Error('employee_files is required');
  }

  const rules: EmployeeFileRules = toEmployeeFileRules(ctx.companyRules);
  const ds = ctx.datasets.get('employee_files')!;
  const rows: DataRow[] = normalizeColumns(ds.rows, ALIASES, {
    role: 'employee_files',
    sourceFile: ds.fileName,
    sourceSheet: ds.sheetName,
    inputSha256: ds.sha256,
  }).map((row) => ({
    ...row,
    phoneHash: hashSensitive(row.phone),
    idNumberHash: hashSensitive(row.idNumber),
  }));

  const byId = new Map<string, DataRow[]>();
  for (const row of rows) {
    const id = asText(row.employeeId);
    if (!id) continue;
    const list = byId.get(id) ?? [];
    list.push(row);
    byId.set(id, list);
  }

  const phoneDups = detectDuplicateKeys(
    rows.filter((r) => asText(r.phoneHash)),
    ['phoneHash'],
  );
  const idDups = detectDuplicateKeys(
    rows.filter((r) => asText(r.idNumberHash)),
    ['idNumberHash'],
  );
  const phoneConflictIds = new Set(phoneDups.flatMap((d) => d.rows.map((r) => asText(r.employeeId))));
  const idConflictIds = new Set(idDups.flatMap((d) => d.rows.map((r) => asText(r.employeeId))));

  const standard: DataRow[] = [];
  const conflicts: DataRow[] = [];
  const missingDocs: DataRow[] = [];
  const contractExpiryRows: DataRow[] = [];
  const licenseExpiryRows: DataRow[] = [];
  const exceptionRows: DataRow[] = [];

  const note = (
    employeeId: string,
    code: string,
    severity: 'INFO' | 'WARNING' | 'BLOCKING',
    message: string,
    sourceTrace: string,
  ) => {
    ctx.exceptions.push({ code, severity, message, row: { employeeId } });
    exceptionRows.push({ employeeId, code, severity, message, sourceTrace });
  };

  for (const [employeeId, group] of [...byId.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sourceTrace = group.map(traceOf).join('|');
    const conflicted = conflictFields(group, [
      'employeeName',
      'department',
      'phone',
      'idNumber',
      'hireDate',
      'employmentStatus',
    ]);
    if (group.length > 1 && conflicted.length > 0) {
      note(employeeId, 'FIELD_CONFLICT', 'BLOCKING', `冲突字段: ${conflicted.join(',')}`, sourceTrace);
      conflicts.push({
        employeeId: maskSensitiveValue(employeeId),
        conflictFields: conflicted.join('|'),
        rowCount: group.length,
        sourceTrace,
        note: '未自动覆盖，保留各来源最新非空值供人工确认',
      });
    }
    if (phoneConflictIds.has(employeeId) || idConflictIds.has(employeeId)) {
      note(employeeId, 'DUPLICATE_IDENTITY', 'BLOCKING', '手机号或证件号跨工号重复', sourceTrace);
      conflicts.push({
        employeeId: maskSensitiveValue(employeeId),
        conflictFields: phoneConflictIds.has(employeeId) ? 'phoneHash' : 'idNumberHash',
        rowCount: group.length,
        sourceTrace,
        note: '重复身份哈希冲突，未自动合并',
      });
    }

    const merged: DataRow = { employeeId };
    const sources: Record<string, string> = {};
    for (const field of [
      'employeeName',
      'department',
      'hireDate',
      'employmentStatus',
      'phone',
      'idNumber',
      'bankAccount',
      'email',
      'contractExpiry',
      'licenseExpiry',
      'idCard',
      'contract',
      'position',
    ]) {
      const picked = pickLatestNonEmpty(group, field);
      merged[field] = picked.value;
      if (picked.source) sources[field] = picked.source;
    }
    merged.phoneHash = hashSensitive(merged.phone);
    merged.idNumberHash = hashSensitive(merged.idNumber);
    merged.sourceTrace = sourceTrace;
    merged.fieldSources = JSON.stringify(sources);

    if (
      hasBlank(merged.employeeId) ||
      hasBlank(merged.employeeName) ||
      hasBlank(merged.department) ||
      hasBlank(merged.hireDate) ||
      hasBlank(merged.employmentStatus)
    ) {
      note(employeeId, 'MISSING_REQUIRED_FIELD', 'BLOCKING', '标准档案必填缺失', sourceTrace);
    }

    for (const doc of rules.requiredDocuments) {
      const present =
        doc === 'idCard'
          ? !hasBlank(merged.idCard) || !hasBlank(merged.idNumber)
          : doc === 'contract'
            ? !hasBlank(merged.contract) || !hasBlank(merged.contractExpiry)
            : doc === 'bankAccount'
              ? !hasBlank(merged.bankAccount)
              : !hasBlank(merged[doc]);
      if (!present) {
        note(employeeId, 'MISSING_DOCUMENT', 'WARNING', `缺失资料: ${doc}`, sourceTrace);
        missingDocs.push({
          employeeId: maskSensitiveValue(employeeId),
          employeeName: maskSensitiveValue(merged.employeeName),
          document: doc,
          sourceTrace,
        });
      }
    }

    const contractDays = (() => {
      const ymd = toYmd(merged.contractExpiry);
      return ymd ? daysBetween(ctx.runDate, ymd) : null;
    })();
    if (contractDays !== null && contractDays <= rules.expiryWarningDays) {
      const code = contractDays < 0 ? 'CONTRACT_EXPIRED' : 'CONTRACT_EXPIRING';
      note(employeeId, code, contractDays < 0 ? 'BLOCKING' : 'WARNING', `合同到期剩余 ${contractDays} 天`, sourceTrace);
      contractExpiryRows.push({
        employeeId: maskSensitiveValue(employeeId),
        employeeName: maskSensitiveValue(merged.employeeName),
        contractExpiry: merged.contractExpiry,
        daysToExpiry: contractDays,
        sourceTrace,
      });
    }

    const licenseDays = (() => {
      const ymd = toYmd(merged.licenseExpiry);
      return ymd ? daysBetween(ctx.runDate, ymd) : null;
    })();
    if (licenseDays !== null && licenseDays <= rules.expiryWarningDays) {
      const code = licenseDays < 0 ? 'LICENSE_EXPIRED' : 'LICENSE_EXPIRING';
      note(employeeId, code, licenseDays < 0 ? 'BLOCKING' : 'WARNING', `证照到期剩余 ${licenseDays} 天`, sourceTrace);
      licenseExpiryRows.push({
        employeeId: maskSensitiveValue(employeeId),
        employeeName: maskSensitiveValue(merged.employeeName),
        licenseExpiry: merged.licenseExpiry,
        daysToExpiry: licenseDays,
        sourceTrace,
      });
    }

    standard.push({
      employeeId: maskSensitiveValue(merged.employeeId),
      employeeName: maskSensitiveValue(merged.employeeName),
      department: merged.department,
      hireDate: merged.hireDate,
      employmentStatus: merged.employmentStatus,
      position: merged.position,
      phone: maskSensitiveValue(merged.phone),
      idNumber: maskSensitiveValue(merged.idNumber),
      bankAccount: maskSensitiveValue(merged.bankAccount),
      email: maskSensitiveValue(merged.email),
      phoneHash: merged.phoneHash,
      idNumberHash: merged.idNumberHash,
      contractExpiry: merged.contractExpiry,
      licenseExpiry: merged.licenseExpiry,
      fieldSources: merged.fieldSources,
      sourceTrace,
    });
  }

  const runNotes = buildHrRunNotes({
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    runDate: ctx.runDate,
    rules: rules as unknown as Record<string, unknown>,
    inputSha256ByRole: ctx.inputSha256ByRole,
    inputRowCount: rows.length,
    outputRowCount: standard.length,
    exceptionCount: exceptionRows.length,
    extras: [{ key: 'matchRule', value: rules.matchRule }],
  });

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '员工档案整理_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '标准员工档案', rows: standard },
      { name: '重复冲突', rows: conflicts },
      { name: '缺失资料', rows: missingDocs },
      { name: '合同到期', rows: contractExpiryRows },
      { name: '证照到期', rows: licenseExpiryRows },
      { name: '运行说明', rows: runNotes },
    ],
  });

  ctx.metrics = {
    employeeCount: standard.length,
    conflictCount: conflicts.length,
    missingDocumentCount: missingDocs.length,
    contractExpiryCount: contractExpiryRows.length,
    licenseExpiryCount: licenseExpiryRows.length,
    exceptionCount: exceptionRows.length,
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
        employeeCount: standard.length,
        conflictCount: conflicts.length,
        missingDocumentCount: missingDocs.length,
        contractExpiryCount: contractExpiryRows.length,
        licenseExpiryCount: licenseExpiryRows.length,
        exceptionCount: exceptionRows.length,
        exceptionByCode: aggregateExceptionCounts(ctx.exceptions).map((e) => ({
          code: e.code,
          count: e.count,
          severity: e.severity,
        })),
      },
      note: 'Aggregates only; masked output; no raw PII.',
    },
  };
}
