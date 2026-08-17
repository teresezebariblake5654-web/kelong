import { dayStamp, writeBusinessWorkbook } from '../shared/excelExport.js';
import { matchHeader, num, pickSheet, str } from '../shared/fieldMatch.js';
import type {
  ProductionDeliverable,
  ProductionException,
  ProductionWorkflowResult,
  RunProductionWorkflowInput,
} from '../shared/types.js';

export const TASK_CODE = 'downtime_loss_close' as const;

type DowntimeEvent = {
  equipment: string;
  line: string;
  reason: string;
  minutes: number;
  date: string;
  standardTakt: number;
  lostOutput: number;
  sourceFile: string;
  sourceRow: number;
};

function classifyReason(text: string): string {
  if (/故障|损坏|维修/.test(text)) return '设备故障';
  if (/换模|换型|调试/.test(text)) return '换型调试';
  if (/缺料|待料/.test(text)) return '待料';
  if (/停电|能源/.test(text)) return '能源中断';
  if (text) return '其他';
  return '未填写';
}

function parse(input: RunProductionWorkflowInput): DowntimeEvent[] {
  const events: DowntimeEvent[] = [];
  let defaultTakt = 1;
  for (const wb of input.workbooks) {
    const taktSheet = pickSheet(wb, ['节拍', '标准', '设备']);
    const taktH = matchHeader(taktSheet.headers, ['标准节拍', '节拍', '节拍秒', '标准节拍秒']);
    if (taktH) {
      for (const row of taktSheet.rows) {
        const t = num(row, taktH);
        if (t > 0) defaultTakt = t;
      }
    }
  }

  for (const wb of input.workbooks) {
    const sheet = pickSheet(wb, ['停机', '故障', '设备', '产量', '计划']);
    const eqH = matchHeader(sheet.headers, ['设备', '设备名称', '机台', '设备编码']);
    const lineH = matchHeader(sheet.headers, ['产线', '生产线', '车间']);
    const reasonH = matchHeader(sheet.headers, ['停机原因', '故障原因', '原因']);
    const minH = matchHeader(sheet.headers, ['停机分钟', '停机时长', '时长', '分钟']);
    const dateH = matchHeader(sheet.headers, ['日期', '停机日期', '发生日期']);
    const taktH = matchHeader(sheet.headers, ['标准节拍', '节拍', '节拍秒']);
    sheet.rows.forEach((row, i) => {
      const minutes = num(row, minH);
      if (!minutes && !str(row, eqH) && !str(row, reasonH)) return;
      const taktSec = num(row, taktH) || defaultTakt;
      // 损失产量 ≈ 停机分钟 * 60 / 节拍秒
      const lostOutput = taktSec > 1e-9 ? Math.round(((minutes * 60) / taktSec) * 1000) / 1000 : 0;
      events.push({
        equipment: str(row, eqH) || '未知设备',
        line: str(row, lineH),
        reason: str(row, reasonH),
        minutes,
        date: str(row, dateH).slice(0, 10),
        standardTakt: taktSec,
        lostOutput,
        sourceFile: wb.fileName,
        sourceRow: i + 1,
      });
    });
  }
  return events;
}

export function runDowntimeLossClose(input: RunProductionWorkflowInput): ProductionWorkflowResult {
  const generatedAt = new Date().toISOString();
  let events = parse(input);
  for (const action of input.actions ?? []) {
    events = events.map((e) => {
      if (action.equipment && e.equipment !== action.equipment) return e;
      if (action.action === 'modify_quantity' && action.value != null) {
        const minutes = Number(action.value);
        if (!Number.isFinite(minutes)) return e;
        const lostOutput =
          e.standardTakt > 1e-9 ? Math.round(((minutes * 60) / e.standardTakt) * 1000) / 1000 : 0;
        return { ...e, minutes, lostOutput };
      }
      return e;
    });
  }

  const long = events.filter((e) => e.minutes > 60);
  const reasonCount = new Map<string, number>();
  for (const e of events) {
    const key = `${e.equipment}|${classifyReason(e.reason)}`;
    reasonCount.set(key, (reasonCount.get(key) ?? 0) + 1);
  }
  const repeats = events.filter((e) => (reasonCount.get(`${e.equipment}|${classifyReason(e.reason)}`) ?? 0) >= 2);

  const ignored = new Set((input.actions ?? []).filter((a) => a.action === 'ignore_once').map((a) => a.equipment));
  const exceptions: ProductionException[] = [
    ...long
      .filter((e) => !ignored.has(e.equipment))
      .map((e) => ({
        code: 'LONG_DOWNTIME',
        severity: 'critical' as const,
        message: `${e.equipment} 停机 ${e.minutes} 分钟，损失产量约 ${e.lostOutput}`,
        equipment: e.equipment,
        line: e.line,
        value: e.minutes,
      })),
    ...repeats
      .filter((e) => !ignored.has(e.equipment))
      .map((e) => ({
        code: 'REPEAT_FAULT',
        severity: 'warning' as const,
        message: `${e.equipment} 重复故障：${classifyReason(e.reason)}`,
        equipment: e.equipment,
        value: e.minutes,
      })),
  ];

  // dedupe exception messages
  const seen = new Set<string>();
  const uniqueExc = exceptions.filter((e) => {
    const k = `${e.code}|${e.equipment}|${e.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    taskCode: TASK_CODE,
    generatedAt,
    blocked: !input.workbooks.length,
    clarifications: input.workbooks.length ? [] : [{ id: 'need', message: '请上传停机记录/设备资料/计划产量/标准节拍' }],
    exceptions: uniqueExc,
    summary: {
      eventCount: events.length,
      totalMinutes: Math.round(events.reduce((s, e) => s + e.minutes, 0) * 1000) / 1000,
      totalLostOutput: Math.round(events.reduce((s, e) => s + e.lostOutput, 0) * 1000) / 1000,
      longCount: long.length,
      repeatCount: repeats.length,
      exceptionCount: uniqueExc.length,
      processedRecordCount: events.length,
      autoClosedCount: Math.max(0, events.length - uniqueExc.length),
      manualConfirmCount: uniqueExc.length,
    },
    tables: {
      events: events.map((e) => ({
        设备: e.equipment,
        产线: e.line,
        停机原因: e.reason,
        AI分类: classifyReason(e.reason),
        停机分钟: e.minutes,
        标准节拍秒: e.standardTakt,
        损失产量: e.lostOutput,
        日期: e.date,
        来源文件: e.sourceFile,
        原始行号: e.sourceRow,
      })),
      loss: events.map((e) => ({
        设备: e.equipment,
        产线: e.line,
        停机分钟: e.minutes,
        损失产量: e.lostOutput,
        计算说明: '损失产量=停机分钟×60/标准节拍秒',
        来源文件: e.sourceFile,
        原始行号: e.sourceRow,
      })),
      maintenance: long.map((e) => ({
        设备: e.equipment,
        产线: e.line,
        停机分钟: e.minutes,
        待办: '安排维修/点检',
        停机原因: e.reason || classifyReason(e.reason),
        来源文件: e.sourceFile,
        原始行号: e.sourceRow,
      })),
      repeat: repeats.map((e) => ({
        设备: e.equipment,
        故障分类: classifyReason(e.reason),
        停机分钟: e.minutes,
        跟踪状态: '重复故障跟踪',
        来源文件: e.sourceFile,
        原始行号: e.sourceRow,
      })),
      manual: uniqueExc.map((e) => ({
        异常类型: e.code,
        设备: e.equipment || '-',
        异常原因: e.message,
        人工确认状态: '待确认',
      })),
    },
    appliedActions: input.actions,
    aiPayload: {
      taskCode: TASK_CODE,
      sampleExceptions: uniqueExc.slice(0, 20),
      note: '停机时长与损失产量由本地计算；AI 仅可分类停机原因。',
    },
  };
}

export function buildDowntimeLossDeliverables(result: ProductionWorkflowResult): ProductionDeliverable[] {
  const day = dayStamp(result.generatedAt);
  return [
    { kind: 'events', fileName: `停机事件明细_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.events ?? [], '停机事件明细') },
    { kind: 'loss', fileName: `停机损失产量_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.loss ?? [], '停机损失产量') },
    { kind: 'maintenance', fileName: `设备维修待办_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.maintenance ?? [], '设备维修待办') },
    { kind: 'repeat', fileName: `重复故障跟踪单_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.repeat ?? [], '重复故障跟踪单') },
    { kind: 'manual', fileName: `人工确认清单_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.manual ?? [], '人工确认清单') },
  ];
}
