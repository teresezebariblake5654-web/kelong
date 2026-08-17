import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  buildRuleSnapshotRows,
} from '../operators/hrCommon.js';
import {
  countDistinct,
  hoursSince,
  isDelayedShipment,
  normalizeDate,
  normalizeShipmentStatus,
  sanitizeLogSummary,
} from '../operators/logisticsCommon.js';
import { hasBlank, normalizeColumns } from '../operators/normalizeColumns.js';
import { toLogTrackRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const SHIP_ALIASES: FieldAliasMap = {
  trackingNo: ['运单号', '物流单号', 'trackingNo', 'tracking_no', '快递单号'],
  carrier: ['承运商', '快递公司', 'carrier', '物流商'],
  shipDate: ['发货日期', 'shipDate', 'ship_date', '寄出日期'],
  status: ['状态', 'status', '物流状态'],
  eta: ['预计到达', 'ETA', 'eta', '预计送达', '时效'],
};

const EVENT_ALIASES: FieldAliasMap = {
  trackingNo: ['运单号', 'trackingNo', 'tracking_no', '物流单号'],
  eventTime: ['时间', 'eventTime', 'event_time', '节点时间'],
  eventDesc: ['描述', 'eventDesc', 'event_desc', '节点说明'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}

/** LOG-SHIPMENT-TRACK-003 — track only; never auto-cancels shipments. */
export async function executeLogShipmentTrack(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('shipments')) throw new Error('shipments is required');
  const rules = toLogTrackRules(ctx.companyRules);
  const shipDs = ctx.datasets.get('shipments')!;
  const shipments = normalizeColumns(shipDs.rows, SHIP_ALIASES, {
    role: 'shipments',
    sourceFile: shipDs.fileName,
    sourceSheet: shipDs.sheetName,
    inputSha256: shipDs.sha256,
  });
  const eventDs = ctx.datasets.get('tracking_events');
  const events = eventDs
    ? normalizeColumns(eventDs.rows, EVENT_ALIASES, {
        role: 'tracking_events',
        sourceFile: eventDs.fileName,
        sourceSheet: eventDs.sheetName,
        inputSha256: eventDs.sha256,
      })
    : [];

  const lastEventByTracking = new Map<string, DataRow>();
  for (const row of events) {
    const no = asText(row.trackingNo).toLowerCase();
    if (!no) continue;
    const prev = lastEventByTracking.get(no);
    if (!prev) {
      lastEventByTracking.set(no, row);
      continue;
    }
    const prevH = hoursSince({ eventTime: prev.eventTime, runDate: ctx.runDate }) ?? Infinity;
    const curH = hoursSince({ eventTime: row.eventTime, runDate: ctx.runDate }) ?? Infinity;
    if (curH < prevH) lastEventByTracking.set(no, row);
  }

  const detail: DataRow[] = [];
  for (const row of shipments) {
    const codes: string[] = [];
    const trackingNo = asText(row.trackingNo);
    const status = normalizeShipmentStatus(row.status);
    if (hasBlank(row.trackingNo) || hasBlank(row.carrier)) codes.push('INVALID');

    if (
      isDelayedShipment({
        eta: row.eta,
        status: row.status,
        runDate: ctx.runDate,
        delayHours: rules.delayHours,
      })
    ) {
      codes.push('DELAYED');
    }

    if (status === 'EXCEPTION' || status === 'UNKNOWN') codes.push('EXCEPTION');

    const last = lastEventByTracking.get(trackingNo.toLowerCase());
    if (events.length > 0 && !last && status !== 'DELIVERED' && status !== 'CANCELLED') {
      codes.push('STALE');
    } else if (last) {
      const h = hoursSince({ eventTime: last.eventTime, runDate: ctx.runDate });
      if (h !== null && h > rules.staleHours && status !== 'DELIVERED' && status !== 'CANCELLED') {
        codes.push('STALE');
      }
    }

    let bucket = 'IN_TRANSIT';
    if (status === 'DELIVERED') bucket = 'DELIVERED';
    else if (codes.includes('DELAYED')) bucket = 'DELAYED';
    else if (codes.includes('EXCEPTION') || codes.includes('STALE')) bucket = 'EXCEPTION';
    else if (status === 'IN_TRANSIT' || status === 'CREATED' || status === 'DELAYED') bucket = 'IN_TRANSIT';
    else if (codes.length) bucket = 'EXCEPTION';

    const shipDate = normalizeDate(row.shipDate);
    detail.push({
      trackingNo,
      carrier: asText(row.carrier),
      shipDate: shipDate.ok ? shipDate.value : asText(row.shipDate),
      status,
      eta: asText(row.eta),
      lastEventTime: last ? asText(last.eventTime) : '',
      lastEventDesc: last ? asText(last.eventDesc) : '',
      exceptionCodes: [...new Set(codes)].join('|'),
      bucket,
      reviewStatus: codes.length ? 'NEEDS_REVIEW' : 'OK',
      sourceTrace: traceOf(row),
    });

    for (const code of [...new Set(codes)]) {
      ctx.exceptions.push({ code, severity: 'WARNING', message: code, row });
    }
  }

  const delayedRows = detail.filter((r) => asText(r.bucket) === 'DELAYED');
  const exceptionRows = detail.filter((r) => asText(r.bucket) === 'EXCEPTION');
  const inTransit = detail.filter((r) => asText(r.bucket) === 'IN_TRANSIT');

  const fileName = renderFileNameTemplate(
    definition.output.fileNameTemplate || '运单追踪_{runDate}.xlsx',
    { runDate: ctx.runDate },
  );
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName,
    sheets: [
      { name: '运单总表', rows: detail },
      { name: '延误', rows: delayedRows },
      { name: '异常', rows: exceptionRows },
      { name: '在途', rows: inTransit },
      { name: '规则快照', rows: buildRuleSnapshotRows(rules as unknown as Record<string, unknown>) },
      {
        name: '运行说明',
        rows: buildHrRunNotes({
          workflowId: definition.id,
          workflowVersion: ctx.workflowVersion,
          runDate: ctx.runDate,
          rules: rules as unknown as Record<string, unknown>,
          inputSha256ByRole: ctx.inputSha256ByRole,
          inputRowCount: shipments.length,
          outputRowCount: detail.length,
          exceptionCount: ctx.exceptions.length,
          extras: [
            { key: 'shipmentCount', value: countDistinct(detail, 'trackingNo') },
            { key: 'cloudUpload', value: false },
            { key: 'autoShip', value: false },
            { key: 'autoCancelShipment', value: false },
          ],
        }),
      },
    ],
  });

  const needsReview = detail.some((r) => asText(r.reviewStatus) === 'NEEDS_REVIEW');
  ctx.metrics = {
    shipmentCount: countDistinct(detail, 'trackingNo'),
    delayedCount: delayedRows.length,
    exceptionCount: exceptionRows.length,
    inTransitCount: inTransit.length,
    cloudUpload: false,
    autoShip: false,
    autoCancelShipment: false,
  };

  return {
    runId: ctx.runId,
    workflowId: definition.id,
    workflowVersion: ctx.workflowVersion,
    status: needsReview ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath],
    metrics: ctx.metrics,
    exceptions: aggregateExceptionCounts(ctx.exceptions),
    aiSummaryPayload: sanitizeLogSummary({
      workflowId: definition.id,
      runId: ctx.runId,
      metrics: { ...ctx.metrics },
    }),
  };
}
