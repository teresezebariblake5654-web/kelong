import * as XLSX from 'xlsx';
import type { MaterialCalcDetail, MaterialDailyBalanceLine, MaterialTicketRow } from './types.js';

const EPS = 1e-9;

export function buildReplenishTickets(balances: MaterialDailyBalanceLine[]): MaterialTicketRow[] {
  const tickets: MaterialTicketRow[] = [];
  for (const line of balances) {
    if (line.replenishQuantity <= EPS) continue;
    const closing = line.closingQuantity ?? line.theoreticalQuantity;
    tickets.push({
      序号: tickets.length + 1,
      单据类型: '补料单',
      物料编码: line.materialCode || '-',
      物料名称: line.materialName,
      规格: line.specification || '-',
      规格型号: line.specification || '-',
      仓库: line.warehouse,
      批次号: line.batchNo || '-',
      单位: line.unit,
      业务日期: line.transactionDate || '-',
      当前结存: closing,
      账面结存: closing,
      安全库存: 0,
      计划需求: line.plannedQuantity,
      实盘数量: line.countedQuantity ?? '-',
      盘亏数量: line.replenishQuantity,
      建议补料数量: line.replenishQuantity,
      缺料原因: line.varianceQuantity != null && line.varianceQuantity < 0 ? '盘亏需补料' : '结存不足',
      备注: line.remark || '实盘低于账面结存，请补料并复核领退料',
    });
  }
  return tickets;
}

export function buildScrapTickets(balances: MaterialDailyBalanceLine[]): MaterialTicketRow[] {
  const tickets: MaterialTicketRow[] = [];
  for (const line of balances) {
    if (line.scrapQuantity <= EPS) continue;
    const ratio = line.issuedQuantity > EPS ? line.scrapQuantity / line.issuedQuantity : 0;
    tickets.push({
      序号: tickets.length + 1,
      单据类型: '报废单',
      物料编码: line.materialCode || '-',
      物料名称: line.materialName,
      规格型号: line.specification || '-',
      仓库: line.warehouse,
      批次号: line.batchNo || '-',
      单位: line.unit,
      业务日期: line.transactionDate || '-',
      报废数量: line.scrapQuantity,
      废料数量: line.scrapQuantity,
      报废比例: Math.round(ratio * 10000) / 10000,
      期初库存: line.openingQuantity,
      领料数量: line.issuedQuantity,
      备注: line.remark || '日清废料需报废审批后出账',
      AI分类: /报废|废品|损坏|不良/.test(line.remark || '') ? '疑似报废' : '待分类',
      人工确认状态: '待确认',
    });
  }
  return tickets;
}

export function buildVarianceTickets(balances: MaterialDailyBalanceLine[]): MaterialTicketRow[] {
  const tickets: MaterialTicketRow[] = [];
  for (const line of balances) {
    if (line.varianceQuantity === null || Math.abs(line.varianceQuantity) <= EPS) continue;
    const closing = line.closingQuantity ?? line.theoreticalQuantity;
    const direction = line.varianceQuantity > EPS ? '盘盈' : '盘亏';
    tickets.push({
      序号: tickets.length + 1,
      单据类型: '盘点差异单',
      差异方向: direction,
      物料编码: line.materialCode || '-',
      物料名称: line.materialName,
      规格型号: line.specification || '-',
      仓库: line.warehouse,
      批次号: line.batchNo || '-',
      单位: line.unit,
      业务日期: line.transactionDate || '-',
      期初库存: line.openingQuantity,
      入库数量: line.inboundQuantity,
      领料数量: line.issuedQuantity,
      退料数量: line.returnedQuantity,
      废料数量: line.scrapQuantity,
      账面结存: closing,
      实盘数量: line.countedQuantity ?? '-',
      差异数量: line.varianceQuantity,
      备注:
        line.remark ||
        (direction === '盘亏' ? '建议开补料并核对领料' : '建议核实多收/漏出账'),
    });
  }
  return tickets;
}

export type WorkbookSheetExport = {
  name: string;
  rows: Array<Record<string, unknown>>;
};

export function exportWorkbook(sheets: WorkbookSheetExport[]): Uint8Array {
  if (!sheets.length) throw new Error('导出工作簿至少需要一个工作表');
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const safeName = sheet.name.slice(0, 31) || 'Sheet1';
    const worksheet =
      sheet.rows.length > 0
        ? XLSX.utils.json_to_sheet(sheet.rows)
        : XLSX.utils.aoa_to_sheet([['（本日无记录）']]);
    XLSX.utils.book_append_sheet(workbook, worksheet, safeName);
  }
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as number[];
  return new Uint8Array(buffer);
}

export function buildMaterialDailyCloseWorkbook(input: {
  generatedAt: string;
  sourceFiles: string[];
  summary: Record<string, number>;
  balances: MaterialDailyBalanceLine[];
  calcDetails?: MaterialCalcDetail[];
  replenishTickets: MaterialTicketRow[];
  scrapTickets: MaterialTicketRow[];
  varianceTickets: MaterialTicketRow[];
}): Uint8Array {
  const overview = [
    {
      生成时间: input.generatedAt,
      来源文件: input.sourceFiles.join('；'),
      结存行数: input.summary.balanceRows ?? input.balances.length,
      补料行数: input.summary.replenishCount ?? input.replenishTickets.length,
      报废行数: input.summary.scrapTicketCount ?? input.scrapTickets.length,
      差异行数: input.summary.varianceCount ?? input.varianceTickets.length,
      建议补料总量: input.summary.totalReplenishQty ?? 0,
      废料总量: input.summary.totalScrapQty ?? 0,
      盘亏总量: input.summary.totalShortageQty ?? 0,
      盘盈总量: input.summary.totalOverageQty ?? 0,
    },
  ];

  const detail = input.balances.map((line, index) => ({
    行号: index + 1,
    物料编码: line.materialCode,
    物料名称: line.materialName,
    规格型号: line.specification,
    仓库: line.warehouse,
    批次号: line.batchNo,
    单位: line.unit,
    业务日期: line.transactionDate,
    期初库存: line.openingQuantity,
    入库数量: line.inboundQuantity,
    领料数量: line.issuedQuantity,
    退料数量: line.returnedQuantity,
    废料数量: line.scrapQuantity,
    账面结存: line.closingQuantity ?? line.theoreticalQuantity,
    实盘数量: line.countedQuantity ?? '',
    盘点差异: line.varianceQuantity ?? '',
    建议补料: line.replenishQuantity,
    计划数量: line.plannedQuantity,
    完工数量: line.actualOutputQuantity,
    备注: line.remark,
  }));

  const audit = (input.calcDetails ?? []).map((item) => ({
    记录码: item.recordCode,
    合并键: item.mergeKey,
    合并策略: item.mergeStrategy,
    物料编码: item.materialCode,
    物料名称: item.materialName,
    仓库: item.warehouse,
    批次: item.batchNo,
    单位: item.unit,
    期初: item.openingQuantity,
    入库: item.inboundQuantity,
    领料: item.issuedQuantity,
    退料: item.returnedQuantity,
    废料: item.scrapQuantity,
    结存: item.closingQuantity,
    实盘: item.countedQuantity ?? '',
    差异: item.varianceQuantity ?? '',
    重复行数: item.duplicateSourceCount,
    来源追溯: item.sourceRows
      .map((s) => `${s.sourceFile}#${s.sourceSheet}:R${s.sourceRowIndex + 1}`)
      .join('；'),
  }));

  return exportWorkbook([
    { name: '日清概览', rows: overview },
    { name: '明细台账', rows: detail },
    { name: '计算追溯', rows: audit },
    { name: '补料单', rows: input.replenishTickets },
    { name: '报废单', rows: input.scrapTickets },
    { name: '盘点差异单', rows: input.varianceTickets },
  ]);
}

export function materialDailyCloseFileName(generatedAt: string, suffix = '物料日清单据包'): string {
  const day = generatedAt.slice(0, 10).replace(/-/g, '');
  return `${suffix}_${day}.xlsx`;
}
