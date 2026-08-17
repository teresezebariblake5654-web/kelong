import * as XLSX from 'xlsx';
import { resolveSafetyStock, type EnterpriseRules } from './enterpriseRules.js';
import type {
  MaterialCalcDetail,
  MaterialDailyBalanceLine,
  MaterialDailyCloseWorkflowResult,
  MaterialException,
  MaterialTicketRow,
} from './types.js';
import type { AppliedExceptionAction } from './exceptionActions.js';

export type DeliverableKind =
  | 'closing_balance'
  | 'replenish'
  | 'scrap'
  | 'variance'
  | 'manual_confirm';

export type DeliverableFile = {
  kind: DeliverableKind;
  fileName: string;
  bytes: Uint8Array;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function formatDate(value: unknown): string {
  if (value == null || value === '') return '';
  const text = String(value).trim();
  if (DATE_RE.test(text)) return text.slice(0, 10);
  const d = new Date(text);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return text;
}

function sourceLine(detail: MaterialCalcDetail | undefined): { 来源文件: string; 原始行号: string } {
  if (!detail?.sourceRows?.length) return { 来源文件: '', 原始行号: '' };
  return {
    来源文件: [...new Set(detail.sourceRows.map((s) => s.sourceFile))].join('；'),
    原始行号: detail.sourceRows.map((s) => s.sourceRowIndex + 1).join('、'),
  };
}

function findDetail(
  details: MaterialCalcDetail[],
  line: MaterialDailyBalanceLine,
): MaterialCalcDetail | undefined {
  return details.find(
    (d) =>
      d.materialCode === line.materialCode &&
      d.warehouse === line.warehouse &&
      (d.batchNo || '') === (line.batchNo || '') &&
      d.unit === line.unit,
  );
}

/** 数量列名（用于数字格式） */
const QTY_HEADERS = new Set([
  '当前结存',
  '安全库存',
  '计划需求',
  '建议补料数量',
  '报废数量',
  '报废比例',
  '期初库存',
  '入库数量',
  '领料数量',
  '退料数量',
  '废料数量',
  '账面结存',
  '实盘数量',
  '差异数量',
  '盘点差异',
]);

function autoColWidth(rows: Array<Record<string, unknown>>, headers: string[]): Array<{ wch: number }> {
  return headers.map((header) => {
    let max = header.length;
    for (const row of rows) {
      const cell = row[header];
      const len = cell == null ? 0 : String(cell).length;
      if (len > max) max = len;
    }
    return { wch: Math.min(Math.max(max + 2, 8), 40) };
  });
}

function writeFormattedSheet(
  rows: Array<Record<string, unknown>>,
  sheetName: string,
): Uint8Array {
  const workbook = XLSX.utils.book_new();
  if (!rows.length) {
    const empty = XLSX.utils.aoa_to_sheet([['（本日无记录）']]);
    XLSX.utils.book_append_sheet(workbook, empty, sheetName.slice(0, 31));
    return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as number[]);
  }

  const headers = Object.keys(rows[0]!);
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });

  // 数字 / 日期格式
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c]!;
      const addr = XLSX.utils.encode_cell({ r: r + 1, c });
      const cell = worksheet[addr];
      if (!cell) continue;
      if (QTY_HEADERS.has(header) && typeof cell.v === 'number') {
        cell.t = 'n';
        cell.z = header === '报废比例' ? '0.00%' : '#,##0.###';
      }
      if (header.includes('日期') && cell.v != null) {
        cell.v = formatDate(cell.v);
        cell.t = 's';
      }
    }
  }

  worksheet['!cols'] = autoColWidth(rows, headers);
  worksheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: rows.length, c: headers.length - 1 },
    }),
  };
  // SheetJS 社区版：冻结首行 + 筛选
  (worksheet as { '!views'?: Array<Record<string, unknown>> })['!views'] = [
    { state: 'frozen', ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' },
  ];

  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as number[]);
}

export function buildClosingBalanceRows(
  balances: MaterialDailyBalanceLine[],
  details: MaterialCalcDetail[],
): Array<Record<string, unknown>> {
  return balances.map((line) => {
    const detail = findDetail(details, line);
    const src = sourceLine(detail);
    return {
      物料编码: line.materialCode || '-',
      物料名称: line.materialName,
      规格: line.specification || '-',
      仓库: line.warehouse,
      批次号: line.batchNo || '-',
      单位: line.unit,
      业务日期: formatDate(line.transactionDate),
      期初库存: line.openingQuantity,
      入库数量: line.inboundQuantity,
      领料数量: line.issuedQuantity,
      退料数量: line.returnedQuantity,
      废料数量: line.scrapQuantity,
      当前结存: line.closingQuantity ?? line.theoreticalQuantity,
      实盘数量: line.countedQuantity ?? '',
      盘点差异: line.varianceQuantity ?? '',
      备注: line.remark || '',
      来源文件: src.来源文件,
      原始行号: src.原始行号,
    };
  });
}

export function buildReplenishDeliverableRows(
  balances: MaterialDailyBalanceLine[],
  details: MaterialCalcDetail[],
  rules: EnterpriseRules,
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const line of balances) {
    if (line.replenishQuantity <= 1e-9 && !(line.plannedQuantity > (line.closingQuantity ?? line.theoreticalQuantity))) {
      // 缺料/低于安全库存也出补料行
      const closing = line.closingQuantity ?? line.theoreticalQuantity;
      const safety = resolveSafetyStock(rules, line.materialCode, line.materialName);
      const need = Math.max(0, safety - closing, line.plannedQuantity - closing);
      if (need <= 1e-9) continue;
      const detail = findDetail(details, line);
      const src = sourceLine(detail);
      let reason = '结存不足';
      if (line.plannedQuantity > closing) reason = '计划需求大于可用库存';
      else if (safety > closing) reason = '低于安全库存';
      rows.push({
        物料编码: line.materialCode || '-',
        物料名称: line.materialName,
        规格: line.specification || '-',
        仓库: line.warehouse,
        当前结存: closing,
        安全库存: safety,
        计划需求: line.plannedQuantity,
        建议补料数量: Math.round(need * 1000) / 1000,
        缺料原因: reason,
        来源文件: src.来源文件,
        原始行号: src.原始行号,
      });
      continue;
    }
    if (line.replenishQuantity <= 1e-9) continue;
    const closing = line.closingQuantity ?? line.theoreticalQuantity;
    const safety = resolveSafetyStock(rules, line.materialCode, line.materialName);
    const detail = findDetail(details, line);
    const src = sourceLine(detail);
    rows.push({
      物料编码: line.materialCode || '-',
      物料名称: line.materialName,
      规格: line.specification || '-',
      仓库: line.warehouse,
      当前结存: closing,
      安全库存: safety,
      计划需求: line.plannedQuantity,
      建议补料数量: line.replenishQuantity,
      缺料原因: line.varianceQuantity != null && line.varianceQuantity < 0 ? '盘亏需补料' : '结存不足',
      来源文件: src.来源文件,
      原始行号: src.原始行号,
    });
  }
  return rows;
}

export function buildScrapDeliverableRows(
  balances: MaterialDailyBalanceLine[],
  details: MaterialCalcDetail[],
  actions: AppliedExceptionAction[] = [],
): Array<Record<string, unknown>> {
  const confirmed = new Set(
    actions
      .filter((a) => a.action === 'confirm_scrap')
      .map((a) => `${a.materialCode ?? ''}|${a.warehouse ?? ''}`),
  );
  return balances
    .filter((line) => line.scrapQuantity > 1e-9)
    .map((line) => {
      const detail = findDetail(details, line);
      const src = sourceLine(detail);
      const ratio = line.issuedQuantity > 1e-9 ? line.scrapQuantity / line.issuedQuantity : 0;
      const key = `${line.materialCode}|${line.warehouse}`;
      const remark = line.remark || '';
      let aiClass = '待分类';
      if (/报废|废品|损坏|不良/.test(remark)) aiClass = '疑似报废';
      else if (/损耗|正常/.test(remark)) aiClass = '工艺损耗';
      else if (remark) aiClass = '备注待判';
      return {
        物料编码: line.materialCode || '-',
        物料名称: line.materialName,
        报废数量: line.scrapQuantity,
        报废比例: ratio,
        备注: remark,
        AI分类: aiClass,
        人工确认状态: confirmed.has(key) ? '已确认报废' : '待确认',
        来源文件: src.来源文件,
        原始行号: src.原始行号,
      };
    });
}

export function buildVarianceDeliverableRows(
  balances: MaterialDailyBalanceLine[],
  details: MaterialCalcDetail[],
): Array<Record<string, unknown>> {
  return balances
    .filter((line) => line.varianceQuantity != null && Math.abs(line.varianceQuantity) > 1e-9)
    .map((line) => {
      const detail = findDetail(details, line);
      const src = sourceLine(detail);
      const direction = (line.varianceQuantity ?? 0) > 0 ? '盘盈' : '盘亏';
      return {
        物料编码: line.materialCode || '-',
        物料名称: line.materialName,
        规格: line.specification || '-',
        仓库: line.warehouse,
        单位: line.unit,
        业务日期: formatDate(line.transactionDate),
        账面结存: line.closingQuantity ?? line.theoreticalQuantity,
        实盘数量: line.countedQuantity ?? '',
        差异数量: line.varianceQuantity ?? 0,
        差异方向: direction,
        异常原因: direction === '盘亏' ? '实盘低于账面' : '实盘高于账面',
        来源文件: src.来源文件,
        原始行号: src.原始行号,
      };
    });
}

export function buildManualConfirmRows(
  exceptions: MaterialException[],
  actions: AppliedExceptionAction[] = [],
  details: MaterialCalcDetail[] = [],
): Array<Record<string, unknown>> {
  const actionByKey = new Map(actions.map((a) => [a.exceptionKey, a]));
  const pending = exceptions.filter((e) => e.severity !== 'info');
  const manualActions = actions.filter((a) => a.action === 'mark_manual' || a.action === 'modify_quantity');

  const rows: Array<Record<string, unknown>> = [];
  for (const exc of pending) {
    const key = [exc.code, exc.materialCode ?? '', exc.materialName ?? '', exc.warehouse ?? '', exc.value ?? ''].join(
      '|',
    );
    const action = actionByKey.get(key);
    const detail = details.find(
      (d) =>
        (!exc.materialCode || d.materialCode === exc.materialCode) &&
        (!exc.warehouse || d.warehouse === exc.warehouse),
    );
    const src = sourceLine(detail);
    rows.push({
      异常类型: exc.code,
      物料编码: exc.materialCode || '-',
      物料名称: exc.materialName || '-',
      仓库: exc.warehouse || '-',
      异常原因: exc.message,
      相关数量: exc.value ?? '',
      人工确认状态: action ? action.action : '待确认',
      确认备注: action?.value != null ? String(action.value) : '',
      来源文件: src.来源文件,
      原始行号: src.原始行号,
    });
  }
  for (const action of manualActions) {
    if (rows.some((r) => r['物料编码'] === (action.materialCode || '-') && r['异常类型'] === action.code)) continue;
    rows.push({
      异常类型: action.code,
      物料编码: action.materialCode || '-',
      物料名称: action.materialName || '-',
      仓库: action.warehouse || '-',
      异常原因: '用户标记人工处理',
      相关数量: action.value ?? '',
      人工确认状态: action.action,
      确认备注: action.value != null ? String(action.value) : '',
      来源文件: '',
      原始行号: '',
    });
  }
  return rows;
}

export function buildFiveDeliverables(input: {
  result: MaterialDailyCloseWorkflowResult;
  rules: EnterpriseRules;
  dayLabel?: string;
}): DeliverableFile[] {
  const day = (input.dayLabel ?? input.result.generatedAt.slice(0, 10)).replace(/-/g, '');
  const { balances, calcDetails = [], exceptions, appliedActions = [] } = input.result;
  const closing = buildClosingBalanceRows(balances, calcDetails);
  const replenish = buildReplenishDeliverableRows(balances, calcDetails, input.rules);
  const scrap = buildScrapDeliverableRows(balances, calcDetails, appliedActions);
  const variance = buildVarianceDeliverableRows(balances, calcDetails);
  const manual = buildManualConfirmRows(exceptions, appliedActions, calcDetails);

  // 禁止写入内部 ID / 模型名 / Token
  const sanitize = (rows: Array<Record<string, unknown>>) =>
    rows.map((row) => {
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        if (/^(id|_id|dbId|model|token|clientRequest)/i.test(k)) continue;
        if (typeof v === 'string' && /sk-[a-zA-Z0-9]{10,}/.test(v)) continue;
        next[k] = v;
      }
      return next;
    });

  return [
    {
      kind: 'closing_balance',
      fileName: `今日物料结存_${day}.xlsx`,
      bytes: writeFormattedSheet(sanitize(closing), '今日物料结存'),
    },
    {
      kind: 'replenish',
      fileName: `补料申请单_${day}.xlsx`,
      bytes: writeFormattedSheet(sanitize(replenish), '补料申请单'),
    },
    {
      kind: 'scrap',
      fileName: `报废待审批单_${day}.xlsx`,
      bytes: writeFormattedSheet(sanitize(scrap), '报废待审批单'),
    },
    {
      kind: 'variance',
      fileName: `盘点差异单_${day}.xlsx`,
      bytes: writeFormattedSheet(sanitize(variance), '盘点差异单'),
    },
    {
      kind: 'manual_confirm',
      fileName: `人工确认清单_${day}.xlsx`,
      bytes: writeFormattedSheet(sanitize(manual), '人工确认清单'),
    },
  ];
}

/** @deprecated 保留兼容：旧单据行构建 */
export function buildReplenishTicketsCompat(rows: Array<Record<string, unknown>>): MaterialTicketRow[] {
  return rows as MaterialTicketRow[];
}
