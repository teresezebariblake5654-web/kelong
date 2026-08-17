import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  assetCodeKey,
  daysUntil,
  normalizeAssetStatus,
  sanitizeAdminSummary,
} from '../operators/adminCommon.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  buildRuleSnapshotRows,
  detectDuplicateKeys,
} from '../operators/hrCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { normalizeDate } from '../operators/normalizeDate.js';
import { toAdminAssetRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const REGISTER_ALIASES: FieldAliasMap = {
  assetCode: ['资产编号', '资产编码', 'asset_code', 'assetCode', '二维码', 'qrCode'],
  assetName: ['资产名称', '名称', 'asset_name', 'assetName', '品名'],
  category: ['类别', '分类', 'category'],
  department: ['部门', 'department', 'dept'],
  custodian: ['责任人', '保管人', 'custodian', 'owner'],
  location: ['位置', '存放位置', 'location'],
  status: ['状态', 'status', '资产状态'],
  purchaseDate: ['购入日期', 'purchaseDate', 'purchase_date'],
};

const COUNT_ALIASES: FieldAliasMap = {
  assetCode: ['资产编号', '资产编码', 'asset_code', 'assetCode', '二维码'],
  actualLocation: ['实盘位置', '实际位置', 'actualLocation', 'actual_location', '位置'],
  actualCustodian: ['实盘责任人', '实际责任人', 'actualCustodian', 'actual_custodian', '责任人'],
  actualStatus: ['实盘状态', '实际状态', 'actualStatus', 'actual_status', '状态'],
  countDate: ['盘点日期', 'countDate', 'count_date', 'date'],
};

const MAINT_ALIASES: FieldAliasMap = {
  assetCode: ['资产编号', '资产编码', 'asset_code', 'assetCode'],
  warrantyEndDate: ['质保到期', 'warrantyEndDate', 'warranty_end', '质保结束日'],
  nextMaintenanceDate: ['下次维保', 'nextMaintenanceDate', 'next_maintenance', '维保日期'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

function pickStatus(codes: string[]): string {
  const order = [
    'MISSING_ASSET',
    'UNREGISTERED',
    'LOCATION_MISMATCH',
    'CUSTODIAN_MISMATCH',
    'STATUS_CONFLICT',
    'DAMAGED',
    'IDLE',
    'MAINTENANCE_DUE',
    'DUPLICATE',
    'INVALID',
  ];
  for (const code of order) if (codes.includes(code)) return code;
  return 'MATCHED';
}

/** ADMIN-ASSET-INVENTORY-001 — diagnose only; never auto-updates asset ledger. */
export async function executeAdminAssetInventory(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('asset_register') || !ctx.datasets.get('physical_count')) {
    throw new Error('asset_register and physical_count are required');
  }
  const rules = toAdminAssetRules(ctx.companyRules);
  const allowed = new Set(rules.allowedStatuses.map((s) => s.toUpperCase()));

  const regDs = ctx.datasets.get('asset_register')!;
  const register = normalizeColumns(regDs.rows, REGISTER_ALIASES, {
    role: 'asset_register',
    sourceFile: regDs.fileName,
    sourceSheet: regDs.sheetName,
    inputSha256: regDs.sha256,
  });
  const countDs = ctx.datasets.get('physical_count')!;
  const counts = normalizeColumns(countDs.rows, COUNT_ALIASES, {
    role: 'physical_count',
    sourceFile: countDs.fileName,
    sourceSheet: countDs.sheetName,
    inputSha256: countDs.sha256,
  });
  const maintDs = ctx.datasets.get('maintenance');
  const maintenance = maintDs
    ? normalizeColumns(maintDs.rows, MAINT_ALIASES, {
        role: 'maintenance',
        sourceFile: maintDs.fileName,
        sourceSheet: maintDs.sheetName,
        inputSha256: maintDs.sha256,
      })
    : [];

  const maintByCode = new Map<string, DataRow>();
  for (const row of maintenance) {
    const key = assetCodeKey(row.assetCode);
    if (key) maintByCode.set(key, row);
  }

  const regDupKeys = new Set(
    detectDuplicateKeys(register.filter((r) => assetCodeKey(r.assetCode)), ['assetCode']).map(
      (g) => g.key.toUpperCase(),
    ),
  );
  const countByCode = new Map<string, DataRow>();
  for (const row of counts) {
    const key = assetCodeKey(row.assetCode);
    if (!key) continue;
    if (!countByCode.has(key)) countByCode.set(key, row);
  }
  const regByCode = new Map<string, DataRow>();
  for (const row of register) {
    const key = assetCodeKey(row.assetCode);
    if (!key) continue;
    if (!regByCode.has(key)) regByCode.set(key, row);
  }

  const allCodes = new Set([...regByCode.keys(), ...countByCode.keys()]);
  const detail: DataRow[] = [];

  for (const code of [...allCodes].sort()) {
    const codes: string[] = [];
    const reg = regByCode.get(code);
    const phy = countByCode.get(code);
    const maint = maintByCode.get(code);

    if (reg && !phy) codes.push('MISSING_ASSET');
    if (!reg && phy) codes.push('UNREGISTERED');
    if (regDupKeys.has(code.toLowerCase()) || regDupKeys.has(code)) codes.push('DUPLICATE');

    const bookStatus = normalizeAssetStatus(reg?.status);
    const actualStatus = normalizeAssetStatus(phy?.actualStatus);
    if (reg && phy) {
      if (
        asText(reg.location) &&
        asText(phy.actualLocation) &&
        asText(reg.location).toLowerCase() !== asText(phy.actualLocation).toLowerCase()
      ) {
        codes.push('LOCATION_MISMATCH');
      }
      if (
        asText(reg.custodian) &&
        asText(phy.actualCustodian) &&
        asText(reg.custodian).toLowerCase() !== asText(phy.actualCustodian).toLowerCase()
      ) {
        codes.push('CUSTODIAN_MISMATCH');
      }
      if (
        bookStatus !== 'UNKNOWN' &&
        actualStatus !== 'UNKNOWN' &&
        bookStatus !== actualStatus
      ) {
        codes.push('STATUS_CONFLICT');
      }
    }

    const statusForIdle = actualStatus !== 'UNKNOWN' ? actualStatus : bookStatus;
    if (statusForIdle === 'DAMAGED') codes.push('DAMAGED');
    if (statusForIdle === 'IDLE') codes.push('IDLE');
    if (
      statusForIdle !== 'UNKNOWN' &&
      allowed.size > 0 &&
      !allowed.has(statusForIdle) &&
      !allowed.has(asText(reg?.status).toUpperCase()) &&
      !allowed.has(asText(phy?.actualStatus).toUpperCase())
    ) {
      codes.push('STATUS_CONFLICT');
    }

    if (reg && (hasBlank(reg.assetCode) || hasBlank(reg.assetName))) codes.push('INVALID');

    let warrantyDaysLeft: number | null = null;
    let maintenanceDaysLeft: number | null = null;
    if (maint) {
      warrantyDaysLeft = daysUntil(ctx.runDate, maint.warrantyEndDate);
      maintenanceDaysLeft = daysUntil(ctx.runDate, maint.nextMaintenanceDate);
      if (
        (warrantyDaysLeft !== null && warrantyDaysLeft <= rules.expiryWarningDays) ||
        (maintenanceDaysLeft !== null && maintenanceDaysLeft <= rules.expiryWarningDays)
      ) {
        codes.push('MAINTENANCE_DUE');
      }
    }

    // Idle by days since purchase when status is IDLE and purchaseDate present
    if (statusForIdle === 'IDLE' && reg?.purchaseDate) {
      const purchased = normalizeDate(reg.purchaseDate);
      if (purchased.ok) {
        const idleAge = daysUntil(purchased.value, ctx.runDate);
        if (idleAge !== null && idleAge >= rules.idleDays) codes.push('IDLE');
      }
    }

    const uniqueCodes = [...new Set(codes)];
    const status = pickStatus(uniqueCodes);
    const row: DataRow = {
      assetCode: code,
      assetName: asText(reg?.assetName ?? ''),
      category: asText(reg?.category ?? ''),
      department: asText(reg?.department ?? ''),
      bookLocation: asText(reg?.location ?? ''),
      actualLocation: asText(phy?.actualLocation ?? ''),
      bookCustodian: asText(reg?.custodian ?? ''),
      actualCustodian: asText(phy?.actualCustodian ?? ''),
      bookStatus,
      actualStatus: actualStatus === 'UNKNOWN' && !phy ? '' : actualStatus,
      countDate: phy
        ? (() => {
            const d = normalizeDate(phy.countDate);
            return d.ok ? d.value : asText(phy.countDate);
          })()
        : '',
      warrantyEndDate: asText(maint?.warrantyEndDate ?? ''),
      nextMaintenanceDate: asText(maint?.nextMaintenanceDate ?? ''),
      warrantyDaysLeft: warrantyDaysLeft ?? '',
      maintenanceDaysLeft: maintenanceDaysLeft ?? '',
      exceptionCodes: uniqueCodes.join('|'),
      status,
      sourceTrace: [reg, phy, maint].filter(Boolean).map((r) => traceOf(r!)).join('|'),
      note: '仅提示差异，不自动修改资产台账',
    };
    detail.push(row);

    for (const codeEx of uniqueCodes) {
      ctx.exceptions.push({
        code: codeEx,
        severity:
          codeEx === 'MISSING_ASSET' || codeEx === 'UNREGISTERED' || codeEx === 'DUPLICATE'
            ? 'BLOCKING'
            : 'WARNING',
        message: codeEx,
        row,
      });
    }
  }

  const shortage = detail.filter((r) => asText(r.exceptionCodes).includes('MISSING_ASSET'));
  const surplus = detail.filter((r) => asText(r.exceptionCodes).includes('UNREGISTERED'));
  const locationCustodian = detail.filter(
    (r) =>
      asText(r.exceptionCodes).includes('LOCATION_MISMATCH') ||
      asText(r.exceptionCodes).includes('CUSTODIAN_MISMATCH'),
  );
  const damagedIdle = detail.filter(
    (r) =>
      asText(r.exceptionCodes).includes('DAMAGED') || asText(r.exceptionCodes).includes('IDLE'),
  );
  const maintRemind = detail.filter((r) => asText(r.exceptionCodes).includes('MAINTENANCE_DUE'));

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '资产盘点结果_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '盘点总表', rows: detail },
      { name: '盘亏', rows: shortage },
      { name: '盘盈', rows: surplus },
      { name: '位置责任人异常', rows: locationCustodian },
      { name: '损坏闲置', rows: damagedIdle },
      { name: '维保提醒', rows: maintRemind },
      { name: '规则快照', rows: buildRuleSnapshotRows(rules as unknown as Record<string, unknown>) },
      {
        name: '运行说明',
        rows: buildHrRunNotes({
          workflowId: definition.id,
          workflowVersion: ctx.workflowVersion,
          runDate: ctx.runDate,
          rules: rules as unknown as Record<string, unknown>,
          inputSha256ByRole: ctx.inputSha256ByRole,
          inputRowCount: register.length + counts.length,
          outputRowCount: detail.length,
          exceptionCount: ctx.exceptions.length,
          extras: [
            { key: 'registerCount', value: regByCode.size },
            { key: 'physicalCount', value: countByCode.size },
            { key: 'inventoryDifferenceCount', value: regByCode.size - countByCode.size },
            { key: 'autoUpdateLedger', value: false },
            { key: 'cloudUpload', value: false },
          ],
        }),
      },
    ],
  });

  const needsReview = detail.some((r) => asText(r.status) !== 'MATCHED');
  ctx.metrics = {
    registerCount: regByCode.size,
    physicalCount: countByCode.size,
    shortageCount: shortage.length,
    surplusCount: surplus.length,
    maintenanceDueCount: maintRemind.length,
    autoUpdateLedger: false,
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
