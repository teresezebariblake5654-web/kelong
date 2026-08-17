import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  contractNoKey,
  daysUntil,
  moneyToFixed,
  normalizeMoney,
  sanitizeAdminSummary,
  toDecimal,
} from '../operators/adminCommon.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  buildRuleSnapshotRows,
  detectDuplicateKeys,
} from '../operators/hrCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import { toAdminContractRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const CONTRACT_ALIASES: FieldAliasMap = {
  contractNo: ['合同号', '合同编号', 'contractNo', 'contract_no', 'contractId'],
  contractName: ['合同名称', '名称', 'contractName', 'contract_name'],
  counterparty: ['对方', '相对方', '供应商', 'counterparty', 'vendor'],
  startDate: ['开始日期', '生效日', 'startDate', 'start_date'],
  endDate: ['结束日期', '到期日', 'endDate', 'end_date', 'expiryDate'],
  owner: ['责任人', 'owner', '经办人'],
  amount: ['金额', '合同金额', 'amount'],
  status: ['状态', 'status'],
  autoRenew: ['自动续约', 'autoRenew', 'auto_renew', '续约'],
  deposit: ['保证金', 'deposit'],
};

const MILESTONE_ALIASES: FieldAliasMap = {
  contractNo: ['合同号', '合同编号', 'contractNo', 'contract_no'],
  milestoneName: ['节点名称', 'milestoneName', 'milestone', '付款节点'],
  dueDate: ['到期日', '应付日期', 'dueDate', 'due_date'],
  amount: ['金额', 'amount'],
  status: ['状态', 'status'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function isAutoRenew(value: unknown): boolean {
  const t = asText(value).toLowerCase();
  return ['y', 'yes', 'true', '1', '是', '自动续约', 'auto', 'auto_renew'].includes(t);
}

function normalizeContractStatus(value: unknown): string {
  const t = asText(value).toLowerCase();
  if (['active', '有效', '履约中', '执行中'].includes(t)) return 'ACTIVE';
  if (['expired', '已到期', '过期', '终止'].includes(t)) return 'EXPIRED';
  if (['draft', '草稿'].includes(t)) return 'DRAFT';
  return t ? t.toUpperCase() : 'UNKNOWN';
}

function pickStatus(codes: string[]): string {
  const order = [
    'EXPIRED',
    'AUTO_RENEW_ACTION_DUE',
    'EXPIRING_SOON',
    'MILESTONE_OVERDUE',
    'MISSING_OWNER',
    'MISSING_FIELDS',
    'INVALID_DATES',
    'MATERIAL_AMOUNT',
    'DUPLICATE',
  ];
  for (const code of order) if (codes.includes(code)) return code;
  return 'ACTIVE';
}

/** ADMIN-CONTRACT-EXPIRY-004 — remind only; never auto-renews or terminates. */
export async function executeAdminContractExpiry(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('contracts')) throw new Error('contracts is required');
  const rules = toAdminContractRules(ctx.companyRules);
  const materialAmount = toDecimal(rules.materialAmount);

  const contractDs = ctx.datasets.get('contracts')!;
  const contracts = normalizeColumns(contractDs.rows, CONTRACT_ALIASES, {
    role: 'contracts',
    sourceFile: contractDs.fileName,
    sourceSheet: contractDs.sheetName,
    inputSha256: contractDs.sha256,
  });
  const msDs = ctx.datasets.get('milestones');
  const milestones = msDs
    ? normalizeColumns(msDs.rows, MILESTONE_ALIASES, {
        role: 'milestones',
        sourceFile: msDs.fileName,
        sourceSheet: msDs.sheetName,
        inputSha256: msDs.sha256,
      })
    : [];

  const dupNos = new Set(
    detectDuplicateKeys(
      contracts.filter((r) => contractNoKey(r.contractNo)),
      ['contractNo'],
    ).map((g) => g.key.toUpperCase()),
  );

  const milestonesByContract = new Map<string, DataRow[]>();
  for (const row of milestones) {
    const key = contractNoKey(row.contractNo);
    if (!key) continue;
    const list = milestonesByContract.get(key) ?? [];
    list.push(row);
    milestonesByContract.set(key, list);
  }

  const detail: DataRow[] = [];
  const overdueMilestones: DataRow[] = [];
  const missingRows: DataRow[] = [];

  for (const row of contracts) {
    const codes: string[] = [];
    const contractNo = contractNoKey(row.contractNo);
    if (dupNos.has(contractNo) || dupNos.has(asText(row.contractNo).toLowerCase())) {
      codes.push('DUPLICATE');
    }

    for (const field of rules.requiredFields) {
      if (hasBlank(row[field])) codes.push('MISSING_FIELDS');
    }
    if (hasBlank(row.owner)) codes.push('MISSING_OWNER');

    const start = normalizeDate(row.startDate);
    const end = normalizeDate(row.endDate);
    if (asText(row.startDate) && !start.ok) codes.push('INVALID_DATES');
    if (asText(row.endDate) && !end.ok) codes.push('INVALID_DATES');
    if (start.ok && end.ok && end.value < start.value) codes.push('INVALID_DATES');

    const daysToExpiry = end.ok ? daysUntil(ctx.runDate, end.value) : null;
    const bookStatus = normalizeContractStatus(row.status);
    const autoRenew = isAutoRenew(row.autoRenew);

    if (daysToExpiry !== null && daysToExpiry < 0) {
      codes.push('EXPIRED');
      if (bookStatus === 'ACTIVE') codes.push('EXPIRED');
    } else if (daysToExpiry !== null && daysToExpiry <= rules.warningDays) {
      codes.push('EXPIRING_SOON');
    }

    if (autoRenew && daysToExpiry !== null && daysToExpiry <= rules.autoRenewNoticeDays) {
      codes.push('AUTO_RENEW_ACTION_DUE');
    }

    const amt = normalizeMoney(row.amount);
    if (amt.ok && amt.value.gte(materialAmount) && codes.some((c) => c === 'EXPIRED' || c === 'EXPIRING_SOON' || c === 'AUTO_RENEW_ACTION_DUE')) {
      codes.push('MATERIAL_AMOUNT');
    }

    const related = milestonesByContract.get(contractNo) ?? [];
    let overdueCount = 0;
    for (const ms of related) {
      const due = normalizeDate(ms.dueDate);
      const daysToMs = due.ok ? daysUntil(ctx.runDate, due.value) : null;
      const msStatus = asText(ms.status).toLowerCase();
      const done = ['done', 'paid', 'completed', '已完成', '已付'].includes(msStatus);
      if (!done && daysToMs !== null && daysToMs < 0) {
        overdueCount += 1;
        codes.push('MILESTONE_OVERDUE');
        overdueMilestones.push({
          contractNo,
          contractName: asText(row.contractName),
          milestoneName: asText(ms.milestoneName),
          dueDate: due.ok ? due.value : asText(ms.dueDate),
          daysToMilestone: daysToMs,
          amount: asText(ms.amount),
          status: asText(ms.status),
          sourceTrace: traceOf(ms),
          note: '仅提醒，不自动续约或终止',
        });
      }
    }

    const uniqueCodes = [...new Set(codes)];
    const status = pickStatus(uniqueCodes);
    const out: DataRow = {
      contractNo,
      contractName: asText(row.contractName),
      counterparty: asText(row.counterparty),
      startDate: start.ok ? start.value : asText(row.startDate),
      endDate: end.ok ? end.value : asText(row.endDate),
      daysToExpiry: daysToExpiry ?? '',
      owner: asText(row.owner),
      amount: amt.ok ? moneyToFixed(amt.value) : asText(row.amount),
      bookStatus,
      autoRenew,
      overdueMilestoneCount: overdueCount,
      exceptionCodes: uniqueCodes.join('|'),
      status,
      sourceTrace: traceOf(row),
      note: '系统只提醒，不自动续约或终止',
    };
    detail.push(out);

    if (uniqueCodes.includes('MISSING_FIELDS') || uniqueCodes.includes('MISSING_OWNER')) {
      missingRows.push({
        ...out,
        missingFields: [
          ...rules.requiredFields.filter((f) => hasBlank(row[f])),
          ...(hasBlank(row.owner) ? ['owner'] : []),
        ].join('|'),
      });
    }

    for (const code of uniqueCodes) {
      ctx.exceptions.push({
        code,
        severity: code === 'EXPIRED' || code === 'MATERIAL_AMOUNT' ? 'BLOCKING' : 'WARNING',
        message: code,
        row: out,
      });
    }
  }

  detail.sort((a, b) => {
    const sa = asText(a.status);
    const sb = asText(b.status);
    if (sa !== sb) return sa.localeCompare(sb);
    const da = Number(a.daysToExpiry);
    const db = Number(b.daysToExpiry);
    if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
    return String(b.amount).localeCompare(String(a.amount));
  });

  const expiring = detail.filter((r) => asText(r.exceptionCodes).includes('EXPIRING_SOON'));
  const expired = detail.filter((r) => asText(r.exceptionCodes).includes('EXPIRED'));
  const autoRenewRows = detail.filter((r) => asText(r.exceptionCodes).includes('AUTO_RENEW'));

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '合同到期提醒_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '合同总表', rows: detail },
      { name: '即将到期', rows: expiring },
      { name: '已过期', rows: expired },
      { name: '自动续约', rows: autoRenewRows },
      { name: '节点逾期', rows: overdueMilestones },
      { name: '资料缺失', rows: missingRows },
      { name: '规则快照', rows: buildRuleSnapshotRows(rules as unknown as Record<string, unknown>) },
      {
        name: '运行说明',
        rows: buildHrRunNotes({
          workflowId: definition.id,
          workflowVersion: ctx.workflowVersion,
          runDate: ctx.runDate,
          rules: rules as unknown as Record<string, unknown>,
          inputSha256ByRole: ctx.inputSha256ByRole,
          inputRowCount: contracts.length,
          outputRowCount: detail.length,
          exceptionCount: ctx.exceptions.length,
          extras: [
            { key: 'autoRenew', value: false },
            { key: 'autoTerminate', value: false },
            { key: 'cloudUpload', value: false },
          ],
        }),
      },
    ],
  });

  const needsReview = detail.some((r) => asText(r.status) !== 'ACTIVE');
  ctx.metrics = {
    contractCount: detail.length,
    expiringCount: expiring.length,
    expiredCount: expired.length,
    overdueMilestoneCount: overdueMilestones.length,
    autoRenew: false,
    autoTerminate: false,
    cloudUpload: false,
  };

  return {
    runId: ctx.runId,
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    status: needsReview ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath],
    metrics: ctx.metrics,
    exceptions: aggregateExceptionCounts(ctx.exceptions),
    aiSummaryPayload: sanitizeAdminSummary({
      workflowId: definition.id,
      workflowVersion: ctx.workflowVersion,
      runId: ctx.runId,
      metrics: { ...ctx.metrics },
    }),
  };
}
