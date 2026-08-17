import type { ExecuteWorkflowResult, WorkflowDefinition } from '@aw/shared';
import type { DataRow } from '../../types.js';
import { exportResultWorkbook, renderFileNameTemplate } from '../exporters/XlsxResultExporter.js';
import { asText, type FieldAliasMap } from '../operators/fieldUtils.js';
import { roomIdKey, sanitizeAdminSummary } from '../operators/adminCommon.js';
import {
  aggregateExceptionCounts,
  buildHrRunNotes,
  buildRuleSnapshotRows,
} from '../operators/hrCommon.js';
import { normalizeColumns } from '../operators/normalizeColumns.js';
import {
  calculateIntervalDurationMinutes,
  detectIntervalOverlap,
  mergeIntervals,
  normalizeDateTime,
  totalIntervalMinutes,
  type TimeInterval,
} from '../operators/normalizeDateTime.js';
import { toAdminRoomRules } from '../rules/RuleStore.js';
import type { OperatorContext } from '../types.js';

const ROOM_ALIASES: FieldAliasMap = {
  roomId: ['会议室ID', '房间ID', 'roomId', 'room_id', '会议室编号'],
  roomName: ['会议室名称', '房间名', 'roomName', 'room_name', '名称'],
  capacity: ['容量', '容纳人数', 'capacity'],
  availableStart: ['开放开始', 'availableStart', 'available_start', '开始时间'],
  availableEnd: ['开放结束', 'availableEnd', 'available_end', '结束时间'],
};
const BOOKING_ALIASES: FieldAliasMap = {
  roomId: ['会议室ID', '房间ID', 'roomId', 'room_id'],
  eventId: ['事件ID', '预约ID', 'eventId', 'event_id', 'bookingId'],
  startTime: ['开始时间', 'startTime', 'start_time', 'start'],
  endTime: ['结束时间', 'endTime', 'end_time', 'end'],
  status: ['状态', 'status'],
  attendeeCount: ['参会人数', '人数', 'attendeeCount', 'attendees'],
};
const CHECKIN_ALIASES: FieldAliasMap = {
  eventId: ['事件ID', '预约ID', 'eventId', 'event_id'],
  checkinTime: ['签到时间', 'checkinTime', 'checkin_time', '签到'],
  checkoutTime: ['签出时间', 'checkoutTime', 'checkout_time', '签退'],
};

function traceOf(row: DataRow): string {
  return `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`;
}
function parseHmToMinutes(value: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(asText(value));
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const dt = normalizeDateTime(value);
  if (!dt.ok) return null;
  const d = new Date(dt.epochMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function bookingStatus(value: unknown): string {
  const t = asText(value).toLowerCase();
  if (['cancelled', 'canceled', '已取消', '取消'].includes(t)) return 'CANCELLED';
  if (['no_show', 'noshow', '爽约', '未到'].includes(t)) return 'NO_SHOW';
  return t ? 'CONFIRMED' : 'UNKNOWN';
}

type ParsedBooking = {
  row: DataRow; roomId: string; eventId: string; status: string;
  startMs: number; endMs: number; date: string; bookedMinutes: number;
  actualMinutes: number; codes: string[]; attendeeCount: number; capacity: number;
};

/** ADMIN-ROOM-UTILIZATION-003 — overlaps merged; never double-counts booked minutes. */
export async function executeAdminRoomUtilization(
  ctx: OperatorContext,
  definition: WorkflowDefinition,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.datasets.get('room_master') || !ctx.datasets.get('bookings')) {
    throw new Error('room_master and bookings are required');
  }
  const rules = toAdminRoomRules(ctx.companyRules);
  const norm = (role: string, aliases: FieldAliasMap) => {
    const ds = ctx.datasets.get(role);
    if (!ds) return [] as DataRow[];
    return normalizeColumns(ds.rows, aliases, {
      role, sourceFile: ds.fileName, sourceSheet: ds.sheetName, inputSha256: ds.sha256,
    });
  };
  const rooms = norm('room_master', ROOM_ALIASES);
  const bookings = norm('bookings', BOOKING_ALIASES);
  const checkins = norm('checkin', CHECKIN_ALIASES);
  const checkByEvent = new Map(checkins.map((r) => [asText(r.eventId), r]));
  const roomById = new Map(rooms.map((r) => [roomIdKey(r.roomId), r]));
  const parsed: ParsedBooking[] = [];
  const anomalyRows: DataRow[] = [];
  const cancelNoShow: DataRow[] = [];

  for (const row of bookings) {
    const codes: string[] = [];
    const roomId = roomIdKey(row.roomId);
    const eventId = asText(row.eventId);
    const status = bookingStatus(row.status);
    const start = normalizeDateTime(row.startTime);
    const end = normalizeDateTime(row.endTime);
    const room = roomById.get(roomId);
    if (!room) codes.push('UNKNOWN_ROOM');
    if (!start.ok || !end.ok) codes.push('INVALID_TIME');
    else if (end.epochMs < start.epochMs) codes.push('END_BEFORE_START');

    let bookedMinutes = 0, startMs = 0, endMs = 0, date = '';
    if (start.ok && end.ok && end.epochMs >= start.epochMs) {
      startMs = start.epochMs; endMs = end.epochMs;
      date = new Date(startMs).toISOString().slice(0, 10);
      bookedMinutes = calculateIntervalDurationMinutes(start.iso, end.iso) ?? 0;
      if (bookedMinutes < rules.minimumBookingMinutes) codes.push('TOO_SHORT');
      const availStart = parseHmToMinutes(room?.availableStart);
      const availEnd = parseHmToMinutes(room?.availableEnd);
      if (availStart !== null && availEnd !== null) {
        const sMin = new Date(startMs).getUTCHours() * 60 + new Date(startMs).getUTCMinutes();
        const eMin = new Date(endMs).getUTCHours() * 60 + new Date(endMs).getUTCMinutes();
        if (sMin < availStart || eMin > availEnd) codes.push('OUTSIDE_AVAILABILITY');
      }
    }

    let actualMinutes = rules.useCheckinAsActual ? 0 : bookedMinutes;
    const check = checkByEvent.get(eventId);
    if (rules.useCheckinAsActual && check) {
      const cin = normalizeDateTime(check.checkinTime);
      const cout = normalizeDateTime(check.checkoutTime);
      if (cin.ok && cout.ok && cout.epochMs >= cin.epochMs) {
        actualMinutes = calculateIntervalDurationMinutes(cin.iso, cout.iso) ?? 0;
      }
      if (start.ok && cin.ok) {
        const lateMin = Math.round((cin.epochMs - start.epochMs) / 60_000);
        if (status === 'CONFIRMED' && lateMin > rules.noShowGraceMinutes) codes.push('NO_SHOW');
      }
    } else if (status === 'CONFIRMED' && rules.useCheckinAsActual && checkins.length > 0 && !check) {
      codes.push('NO_SHOW');
    }
    if (status === 'CANCELLED') codes.push('CANCELLED');
    if (status === 'NO_SHOW') codes.push('NO_SHOW');
    const capacity = Number(asText(room?.capacity) || '0');
    const attendeeCount = Number(asText(row.attendeeCount) || '0');
    if (capacity >= 8 && attendeeCount > 0 && attendeeCount <= capacity * 0.25) {
      codes.push('CAPACITY_MISMATCH');
    }

    const item: ParsedBooking = {
      row, roomId, eventId, status, startMs, endMs, date, bookedMinutes, actualMinutes,
      codes: [...new Set(codes)], attendeeCount, capacity,
    };
    parsed.push(item);
    for (const code of item.codes) ctx.exceptions.push({ code, severity: 'WARNING', message: code, row });
    if (item.codes.some((c) => ['INVALID_TIME', 'END_BEFORE_START', 'OUTSIDE_AVAILABILITY', 'UNKNOWN_ROOM'].includes(c))) {
      anomalyRows.push({
        roomId, eventId, exceptionCodes: item.codes.join('|'),
        startTime: asText(row.startTime), endTime: asText(row.endTime), sourceTrace: traceOf(row),
      });
    }
    if (item.codes.includes('CANCELLED') || item.codes.includes('NO_SHOW')) {
      cancelNoShow.push({
        roomId, eventId, status, exceptionCodes: item.codes.join('|'), bookedMinutes, sourceTrace: traceOf(row),
      });
    }
  }

  const active = parsed.filter((b) => b.startMs > 0 && b.endMs > b.startMs && !b.codes.includes('CANCELLED'));
  for (const roomId of new Set(active.map((b) => b.roomId))) {
    const roomBookings = active.filter((b) => b.roomId === roomId);
    const intervals: TimeInterval[] = roomBookings.map((b) => ({ startMs: b.startMs, endMs: b.endMs }));
    for (const ov of detectIntervalOverlap(intervals)) {
      const a = roomBookings[ov.aIndex]!;
      const b = roomBookings[ov.bIndex]!;
      a.codes.push('OVERLAP'); b.codes.push('OVERLAP');
      anomalyRows.push({
        roomId, eventId: `${a.eventId}|${b.eventId}`, exceptionCodes: 'OVERLAP',
        startTime: '', endTime: '', sourceTrace: `${traceOf(a.row)}|${traceOf(b.row)}`,
      });
      ctx.exceptions.push({ code: 'OVERLAP', severity: 'WARNING', message: '预约时间重叠', row: { roomId, eventId: a.eventId } });
    }
  }

  const overview: DataRow[] = [];
  const daily: DataRow[] = [];
  const peakMap = new Map<string, number>();
  const capacityRows: DataRow[] = [];

  for (const room of rooms) {
    const roomId = roomIdKey(room.roomId);
    const roomActive = active.filter((b) => b.roomId === roomId);
    const byDate = new Map<string, ParsedBooking[]>();
    for (const b of roomActive) {
      const list = byDate.get(b.date) ?? [];
      list.push(b); byDate.set(b.date, list);
    }
    const availStart = parseHmToMinutes(room.availableStart) ?? 9 * 60;
    const availEnd = parseHmToMinutes(room.availableEnd) ?? 18 * 60;
    const dailyAvail = Math.max(0, availEnd - availStart);
    const dateCount = Math.max(byDate.size, 1);
    const availableMinutes = dailyAvail * Math.min(dateCount, rules.workingDays || dateCount);
    let bookedMerged = 0, usedMinutes = 0, cancelledCount = 0, noShowCount = 0, confirmedCount = 0;

    for (const [date, list] of byDate) {
      const dayBooked = totalIntervalMinutes(mergeIntervals(list.map((b) => ({ startMs: b.startMs, endMs: b.endMs }))));
      bookedMerged += dayBooked;
      const dayUsed = rules.useCheckinAsActual ? list.reduce((s, b) => s + b.actualMinutes, 0) : dayBooked;
      usedMinutes += dayUsed;
      const utilBooked = dailyAvail > 0 ? dayBooked / dailyAvail : 0;
      const utilActual = dailyAvail > 0 ? dayUsed / dailyAvail : 0;
      if (utilBooked > 1.0001 || utilActual > 1.0001) {
        ctx.exceptions.push({ code: 'UTILIZATION_OVER_100', severity: 'WARNING', message: '利用率超过100%', row: { roomId, date } });
        anomalyRows.push({ roomId, eventId: '', exceptionCodes: 'UTILIZATION_OVER_100', startTime: date, endTime: '', sourceTrace: '' });
      }
      daily.push({
        roomId, roomName: asText(room.roomName), date, availableMinutes: dailyAvail,
        bookedMinutes: Math.round(dayBooked), usedMinutes: Math.round(dayUsed),
        bookedUtilization: utilBooked.toFixed(4), actualUtilization: utilActual.toFixed(4),
      });
      for (let h = Math.floor(availStart / 60); h < Math.ceil(availEnd / 60); h += 1) {
        const bucketStart = Date.parse(`${date}T${String(h).padStart(2, '0')}:00:00Z`);
        const bucketEnd = bucketStart + 3_600_000;
        const mins = totalIntervalMinutes(mergeIntervals(
          list.map((b) => ({ startMs: Math.max(b.startMs, bucketStart), endMs: Math.min(b.endMs, bucketEnd) }))
            .filter((i) => i.endMs > i.startMs),
        ));
        if (mins > 0) {
          const key = `${roomId}||${date}||${String(h).padStart(2, '0')}:00`;
          peakMap.set(key, (peakMap.get(key) ?? 0) + mins);
        }
      }
    }
    for (const b of parsed.filter((p) => p.roomId === roomId)) {
      if (b.codes.includes('CANCELLED')) cancelledCount += 1;
      if (b.codes.includes('NO_SHOW')) noShowCount += 1;
      if (b.status === 'CONFIRMED') confirmedCount += 1;
    }
    overview.push({
      roomId, roomName: asText(room.roomName), capacity: asText(room.capacity),
      availableMinutes: Math.round(availableMinutes), bookedMinutes: Math.round(bookedMerged),
      usedMinutes: Math.round(usedMinutes),
      utilizationRate: availableMinutes > 0 ? (bookedMerged / availableMinutes).toFixed(4) : '0',
      cancelledCount, noShowCount,
      noShowRate: confirmedCount > 0 ? (noShowCount / confirmedCount).toFixed(4) : '0',
      overlapPrevented: true,
    });
    for (const b of roomActive.filter((x) => x.codes.includes('CAPACITY_MISMATCH'))) {
      capacityRows.push({
        roomId, eventId: b.eventId, capacity: b.capacity, attendeeCount: b.attendeeCount,
        fillRate: b.capacity > 0 ? (b.attendeeCount / b.capacity).toFixed(4) : '',
        exceptionCodes: 'CAPACITY_MISMATCH', sourceTrace: traceOf(b.row),
      });
    }
  }

  const peakAgg: DataRow[] = [...peakMap.entries()]
    .map(([key, mins]) => {
      const [roomId, date, hourBucket] = key.split('||');
      return { roomId, date, hourBucket, bookedMinutes: Math.round(mins) };
    })
    .sort((a, b) => Number(b.bookedMinutes) - Number(a.bookedMinutes));

  const period = ctx.runDate.slice(0, 7);
  const outputPath = exportResultWorkbook({
    outputDir: ctx.request.outputDir,
    fileName: renderFileNameTemplate(definition.output.fileNameTemplate || '会议室利用率_{period}.xlsx', {
      runDate: ctx.runDate, period,
    }),
    sheets: [
      { name: '会议室总览', rows: overview },
      { name: '每日利用率', rows: daily },
      { name: '高峰时段', rows: peakAgg },
      { name: '取消爽约', rows: cancelNoShow },
      { name: '容量匹配', rows: capacityRows },
      { name: '数据异常', rows: anomalyRows },
      { name: '规则快照', rows: buildRuleSnapshotRows(rules as unknown as Record<string, unknown>) },
      {
        name: '运行说明',
        rows: buildHrRunNotes({
          workflowId: definition.id, workflowVersion: ctx.workflowVersion, runDate: ctx.runDate,
          rules: rules as unknown as Record<string, unknown>, inputSha256ByRole: ctx.inputSha256ByRole,
          inputRowCount: bookings.length, outputRowCount: overview.length, exceptionCount: ctx.exceptions.length,
          extras: [{ key: 'overlapDoubleCount', value: false }, { key: 'cloudUpload', value: false }],
        }),
      },
    ],
  });

  ctx.metrics = { roomCount: rooms.length, bookingCount: bookings.length, overlapDoubleCount: false, cloudUpload: false };
  return {
    runId: ctx.runId, workflowId: definition.id, workflowVersion: ctx.workflowVersion,
    status: anomalyRows.length || cancelNoShow.length ? 'NEEDS_REVIEW' : 'COMPLETED',
    outputFiles: [outputPath], metrics: ctx.metrics, exceptions: aggregateExceptionCounts(ctx.exceptions),
    aiSummaryPayload: sanitizeAdminSummary({
      workflowId: definition.id, workflowVersion: ctx.workflowVersion, runId: ctx.runId, metrics: { ...ctx.metrics },
    }),
  };
}
