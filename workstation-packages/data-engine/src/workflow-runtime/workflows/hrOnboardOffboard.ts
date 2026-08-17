import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { addDaysYmd, daysBetween } from '../operators/dateWindow.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  detectDuplicateKeys,
} from '../operators/hrCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import { toOnboardOffboardRules, type OnboardOffboardRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const ID = ['工号', '员工编号', '员工号', 'employee_id', 'empId'];
const CHANGE_ALIASES: FieldAliasMap = {
  employeeId: ID,
  employeeName: ['姓名', '员工姓名', 'employee_name', 'name'],
  changeType: ['变动类型', '类型', 'change_type', 'type'],
  effectiveDate: ['生效日期', '生效日', 'effective_date'],
  department: ['部门', 'dept', 'department'],
  position: ['岗位', '职位', 'position'],
};
const TEMPLATE_ALIASES: FieldAliasMap = {
  changeType: ['变动类型', '类型', 'change_type', 'type'],
  department: ['部门', 'dept', 'department'],
  taskName: ['任务', '任务名称', 'task_name', 'name'],
  ownerRole: ['负责角色', '角色', 'owner_role', 'owner'],
  dueOffsetDays: ['截止偏移天', '偏移天数', 'due_offset_days', 'offset'],
  blocking: ['是否阻塞', '阻塞', 'blocking'],
};
const STATUS_ALIASES: FieldAliasMap = {
  employeeId: ID,
  taskName: ['任务', '任务名称', 'task_name', 'name'],
  status: ['状态', '完成状态', 'task_status', 'status'],
  completedAt: ['完成时间', '完成日', 'completed_at'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function toYmd(value: unknown): string {
  const parsed = normalizeDate(value);
  return parsed.ok ? parsed.value : asText(value).slice(0, 10);
}

function normalizeChangeType(raw: unknown): 'ONBOARD' | 'TRANSFER' | 'OFFBOARD' | string {
  const t = asText(raw).toUpperCase();
  const original = asText(raw);
  if (t === 'ONBOARD' || original.includes('入职')) return 'ONBOARD';
  if (t === 'OFFBOARD' || original.includes('离职')) return 'OFFBOARD';
  if (t === 'TRANSFER' || original.includes('调岗') || original.includes('调动')) return 'TRANSFER';
  return t || 'UNKNOWN';
}

function isCompletedStatus(raw: unknown): boolean {
  const t = asText(raw).toUpperCase();
  const original = asText(raw);
  return t === 'DONE' || t === 'COMPLETED' || original.includes('完成') || original.includes('已办');
}

function isBlockingTask(taskName: string, blockingFlag: unknown, rules: OnboardOffboardRules): boolean {
  if (String(blockingFlag).toLowerCase() === 'true' || asText(blockingFlag) === '是') return true;
  if (rules.blockingTasks.some((t) => taskName.includes(t) || t.includes(taskName))) return true;
  return /资产|账号|账户/.test(taskName);
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

/** Thin orchestrator for HR-ONBOARD-OFFBOARD-004. No automatic account/asset ops. */
export async function executeHrOnboardOffboard(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('employee_changes') || !ctx.datasets.get('task_template')) {
    throw new Error('employee_changes and task_template are required');
  }

  const rules = toOnboardOffboardRules(ctx.companyRules);
  const changes = normRole(ctx, 'employee_changes', CHANGE_ALIASES);
  const templates = normRole(ctx, 'task_template', TEMPLATE_ALIASES);
  const statuses = normRole(ctx, 'task_status', STATUS_ALIASES);

  const dupEmployees = new Set(detectDuplicateKeys(changes, ['employeeId', 'changeType']).map((d) => d.key));
  const statusMap = new Map<string, DataRow>();
  for (const row of statuses) {
    statusMap.set(`${asText(row.employeeId).toLowerCase()}||${asText(row.taskName).toLowerCase()}`, row);
  }

  const allTasks: DataRow[] = [];
  const overview: DataRow[] = [];
  const exceptionRows: DataRow[] = [];

  for (const change of changes) {
    const employeeId = asText(change.employeeId);
    const employeeName = asText(change.employeeName);
    const changeType = normalizeChangeType(change.changeType);
    const effectiveDate = toYmd(change.effectiveDate);
    const department = asText(change.department);
    const sourceTrace = traceOf(change);
    const note = (code: string, severity: 'INFO' | 'WARNING' | 'BLOCKING', message: string) => {
      ctx.exceptions.push({ code, severity, message, row: { employeeId } });
      exceptionRows.push({ employeeId, employeeName, code, severity, message, sourceTrace });
    };

    if (!employeeId || hasBlank(change.employeeName) || !changeType || !effectiveDate || !department) {
      note('MISSING_REQUIRED_FIELD', 'BLOCKING', '人员变动必填缺失');
    }
    if (employeeId && dupEmployees.has(`${employeeId.toLowerCase()}||${changeType.toLowerCase()}`)) {
      note('DUPLICATE_CHANGE', 'WARNING', '同一工号变动类型重复');
    }

    const matchedTemplates = templates.filter((tpl) => {
      const tplType = normalizeChangeType(tpl.changeType);
      const tplDept = asText(tpl.department);
      return tplType === changeType && (!tplDept || tplDept === '*' || tplDept === department);
    });

    if (matchedTemplates.length === 0) {
      note('MISSING_TEMPLATE', 'BLOCKING', '无匹配任务模板');
    }

    let completed = 0;
    let blockingOpen = 0;
    for (const tpl of matchedTemplates) {
      const taskName = asText(tpl.taskName);
      const dueOffset = Number(tpl.dueOffsetDays ?? 0);
      const dueDate = addDaysYmd(effectiveDate, dueOffset) ?? effectiveDate;
      const statusRow = statusMap.get(`${employeeId.toLowerCase()}||${taskName.toLowerCase()}`);
      const completedFlag = statusRow ? isCompletedStatus(statusRow.status) : false;
      const blocking = isBlockingTask(taskName, tpl.blocking, rules);
      const overdue =
        !completedFlag && daysBetween(dueDate, ctx.runDate) !== null && (daysBetween(dueDate, ctx.runDate) ?? 0) > 0;
      const ownerRole = asText(tpl.ownerRole);
      const owner =
        rules.defaultOwners[ownerRole] ?? rules.defaultOwners[ownerRole.toUpperCase()] ?? ownerRole;

      if (!owner) note('MISSING_OWNER', 'WARNING', `任务无负责人: ${taskName}`);
      if (completedFlag) completed += 1;
      if (blocking && !completedFlag) {
        blockingOpen += 1;
        if (/资产/.test(taskName)) note('ASSET_OPEN', 'BLOCKING', `资产任务未完成: ${taskName}`);
        if (/账号|账户/.test(taskName)) note('ACCOUNT_OPEN', 'BLOCKING', `账号任务未完成: ${taskName}`);
      }
      if (overdue) note('TASK_OVERDUE', 'WARNING', `任务逾期: ${taskName}`);

      allTasks.push({
        employeeId,
        employeeName,
        changeType,
        department,
        position: change.position,
        taskName,
        ownerRole,
        owner,
        dueDate,
        status: completedFlag ? 'COMPLETED' : overdue ? 'OVERDUE' : 'PENDING',
        blocking,
        completedAt: statusRow?.completedAt ?? '',
        sourceTrace: `${sourceTrace}|${traceOf(tpl)}`,
      });
    }

    const total = matchedTemplates.length;
    const completionRate = total === 0 ? 0 : Number((completed / total).toFixed(4));
    const canClose = blockingOpen === 0 && total > 0;
    overview.push({
      employeeId,
      employeeName,
      changeType,
      department,
      position: change.position,
      effectiveDate,
      totalTasks: total,
      completedTasks: completed,
      blockingOpen,
      completionRate,
      closeStatus: canClose ? 'READY_TO_CLOSE' : 'BLOCKED',
      sourceTrace,
      note: '不自动执行账号/资产操作',
    });
    if (!canClose && total > 0) {
      note('CLOSE_BLOCKED', 'BLOCKING', '阻塞任务未完成，不得办结');
    }
  }

  const pending = allTasks.filter((t) => asText(t.status) === 'PENDING');
  const completedTasks = allTasks.filter((t) => asText(t.status) === 'COMPLETED');
  const overdueTasks = allTasks.filter((t) => asText(t.status) === 'OVERDUE');
  const blocked = allTasks.filter((t) => Boolean(t.blocking) && asText(t.status) !== 'COMPLETED');

  const runNotes = buildHrRunNotes({
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    runDate: ctx.runDate,
    rules: rules as unknown as Record<string, unknown>,
    inputSha256ByRole: ctx.inputSha256ByRole,
    inputRowCount: changes.length,
    outputRowCount: overview.length,
    exceptionCount: exceptionRows.length,
    extras: [{ key: 'autoAccountAssetOps', value: false }],
  });

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '入离职任务处理_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '人员总览', rows: overview },
      { name: '待办任务', rows: pending },
      { name: '已完成任务', rows: completedTasks },
      { name: '逾期任务', rows: overdueTasks },
      { name: '阻塞办结', rows: blocked },
      { name: '运行说明', rows: runNotes },
    ],
  });

  ctx.metrics = {
    employeeCount: overview.length,
    taskCount: allTasks.length,
    pendingCount: pending.length,
    completedCount: completedTasks.length,
    overdueCount: overdueTasks.length,
    blockedCount: blocked.length,
    exceptionCount: exceptionRows.length,
    localExecution: true,
    cloudUpload: false,
    uploadedRawWorkbook: false,
    autoAccountAssetOps: false,
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
        employeeCount: overview.length,
        taskCount: allTasks.length,
        pendingCount: pending.length,
        completedCount: completedTasks.length,
        overdueCount: overdueTasks.length,
        blockedCount: blocked.length,
        exceptionCount: exceptionRows.length,
        exceptionByCode: aggregateExceptionCounts(ctx.exceptions).map((e) => ({
          code: e.code,
          count: e.count,
          severity: e.severity,
        })),
      },
      note: 'Aggregates only; no automatic account/asset operations.',
    },
  };
}
