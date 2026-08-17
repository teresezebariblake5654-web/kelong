import { dayStamp, writeBusinessWorkbook } from '../shared/excelExport.js';
import { matchHeader, num, pickSheet, str } from '../shared/fieldMatch.js';
import type {
  AppliedProductionAction,
  ProductionDeliverable,
  ProductionException,
  ProductionWorkflowResult,
  RawWorkbook,
  RunProductionWorkflowInput,
} from '../shared/types.js';

export const TASK_CODE = 'production_plan_close' as const;

type WorkOrderLine = {
  workOrder: string;
  product: string;
  line: string;
  planned: number;
  completed: number;
  wip: number;
  dueDate: string;
  status: string;
  blockedReason: string;
  sourceFile: string;
  sourceRow: number;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function parseOrders(workbooks: RawWorkbook[]): WorkOrderLine[] {
  const lines: WorkOrderLine[] = [];
  for (const wb of workbooks) {
    const sheet = pickSheet(wb, ['计划', '工单', '完工', '在制']);
    const woH = matchHeader(sheet.headers, ['工单号', '生产工单', '订单号', '工单']);
    const productH = matchHeader(sheet.headers, ['产品', '产品名称', '物料', 'SKU']);
    const lineH = matchHeader(sheet.headers, ['产线', '生产线', '车间', '班组']);
    const planH = matchHeader(sheet.headers, ['计划数量', '工单数量', '计划产量']);
    const doneH = matchHeader(sheet.headers, ['完成数量', '报工数量', '完工数量', '实际产量']);
    const wipH = matchHeader(sheet.headers, ['在制数量', '在制', 'WIP']);
    const dueH = matchHeader(sheet.headers, ['计划完成日', '交期', '计划日期', '到期日']);
    const statusH = matchHeader(sheet.headers, ['状态', '工单状态', '在制状态']);
    const blockH = matchHeader(sheet.headers, ['阻塞原因', '异常原因', '备注']);
    sheet.rows.forEach((row, i) => {
      const workOrder = str(row, woH);
      if (!workOrder && !str(row, productH)) return;
      lines.push({
        workOrder: workOrder || `ROW-${i + 1}`,
        product: str(row, productH),
        line: str(row, lineH),
        planned: num(row, planH),
        completed: num(row, doneH),
        wip: num(row, wipH),
        dueDate: str(row, dueH).slice(0, 10),
        status: str(row, statusH) || (num(row, doneH) >= num(row, planH) && num(row, planH) > 0 ? '已完成' : '进行中'),
        blockedReason: str(row, blockH),
        sourceFile: wb.fileName,
        sourceRow: i + 1,
      });
    });
  }
  return lines;
}

function applyActions(lines: WorkOrderLine[], actions: AppliedProductionAction[]): WorkOrderLine[] {
  return lines.map((line) => {
    const act = actions.find((a) => a.workOrder === line.workOrder);
    if (!act) return line;
    if (act.action === 'modify_quantity' && act.value != null) {
      const qty = Number(act.value);
      if (Number.isFinite(qty)) return { ...line, completed: qty };
    }
    if (act.action === 'confirm') return { ...line, status: '已关闭' };
    return line;
  });
}

export function runProductionPlanClose(input: RunProductionWorkflowInput): ProductionWorkflowResult {
  const generatedAt = new Date().toISOString();
  let lines = parseOrders(input.workbooks);
  lines = applyActions(lines, input.actions ?? []);
  const day = today();

  const todo = lines.filter((l) => l.completed + 1e-9 < l.planned && l.status !== '已关闭');
  const delayed = lines.filter(
    (l) => l.dueDate && l.dueDate < day && l.completed + 1e-9 < l.planned && l.status !== '已关闭',
  );
  const blocked = lines.filter(
    (l) => /阻塞|缺料|停线|待料|故障/.test(l.blockedReason + l.status) || l.status === '阻塞',
  );
  const doneToClose = lines.filter(
    (l) => l.planned > 0 && l.completed + 1e-9 >= l.planned && l.status !== '已关闭',
  );

  const exceptions: ProductionException[] = [
    ...delayed.map((l) => ({
      code: 'DELAYED_WO',
      severity: 'critical' as const,
      message: `工单 ${l.workOrder} 已延期（交期 ${l.dueDate}）`,
      workOrder: l.workOrder,
      value: l.planned - l.completed,
    })),
    ...blocked.map((l) => ({
      code: 'BLOCKED_WO',
      severity: 'critical' as const,
      message: `工单 ${l.workOrder} 阻塞：${l.blockedReason || l.status}`,
      workOrder: l.workOrder,
    })),
  ];

  const ignored = new Set(
    (input.actions ?? []).filter((a) => a.action === 'ignore_once').map((a) => a.workOrder),
  );
  const visibleExc = exceptions.filter((e) => !ignored.has(e.workOrder));

  return {
    taskCode: TASK_CODE,
    generatedAt,
    blocked: false,
    clarifications: input.workbooks.length ? [] : [{ id: 'need', message: '请上传生产计划/工单/完工/在制表' }],
    exceptions: visibleExc,
    summary: {
      workOrderCount: lines.length,
      todoCount: todo.length,
      delayedCount: delayed.length,
      blockedCount: blocked.length,
      doneToCloseCount: doneToClose.length,
      exceptionCount: visibleExc.length,
      processedRecordCount: lines.length,
      autoClosedCount: Math.max(0, lines.length - visibleExc.length),
      manualConfirmCount: visibleExc.length,
    },
    tables: {
      todo: todo.map((l) => ({
        工单号: l.workOrder,
        产品: l.product,
        产线: l.line,
        计划数量: l.planned,
        完成数量: l.completed,
        剩余数量: Math.round((l.planned - l.completed) * 1000) / 1000,
        交期: l.dueDate,
        来源文件: l.sourceFile,
        原始行号: l.sourceRow,
      })),
      delayed: delayed.map((l) => ({
        工单号: l.workOrder,
        产品: l.product,
        交期: l.dueDate,
        剩余数量: Math.round((l.planned - l.completed) * 1000) / 1000,
        异常原因: '超过计划完成日仍未完工',
        来源文件: l.sourceFile,
        原始行号: l.sourceRow,
      })),
      blocked: blocked.map((l) => ({
        工单号: l.workOrder,
        产品: l.product,
        阻塞原因: l.blockedReason || l.status,
        在制数量: l.wip,
        来源文件: l.sourceFile,
        原始行号: l.sourceRow,
      })),
      doneToClose: doneToClose.map((l) => ({
        工单号: l.workOrder,
        产品: l.product,
        计划数量: l.planned,
        完成数量: l.completed,
        状态: l.status,
        建议: '已完成待关闭',
        来源文件: l.sourceFile,
        原始行号: l.sourceRow,
      })),
      adjust: [...todo, ...delayed].map((l) => ({
        工单号: l.workOrder,
        产品: l.product,
        调整建议: l.dueDate && l.dueDate < day ? '调整交期或加急' : '纳入今日待完成',
        剩余数量: Math.round((l.planned - l.completed) * 1000) / 1000,
        来源文件: l.sourceFile,
        原始行号: l.sourceRow,
      })),
    },
    appliedActions: input.actions,
    aiPayload: {
      taskCode: TASK_CODE,
      sampleExceptions: visibleExc.slice(0, 20),
      note: '进度与延期由本地规则判定，禁止上传完整生产表。',
    },
  };
}

export function buildProductionPlanDeliverables(result: ProductionWorkflowResult): ProductionDeliverable[] {
  const day = dayStamp(result.generatedAt);
  return [
    { kind: 'todo', fileName: `今日待完成工单_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.todo ?? [], '今日待完成工单') },
    { kind: 'delayed', fileName: `延期工单_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.delayed ?? [], '延期工单') },
    { kind: 'blocked', fileName: `阻塞工单_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.blocked ?? [], '阻塞工单') },
    { kind: 'done', fileName: `已完成待关闭_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.doneToClose ?? [], '已完成待关闭') },
    { kind: 'adjust', fileName: `生产进度调整清单_${day}.xlsx`, bytes: writeBusinessWorkbook(result.tables.adjust ?? [], '生产进度调整清单') },
  ];
}
