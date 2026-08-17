import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildTicketPackageBytes,
  detectSheet,
  materialDailyCloseFileName,
  runMaterialDailyCloseWorkflow,
  StandardMaterialRowSchema,
  workbookToWorkflowInput,
} from '../index.js';

describe('standard field zod schemas', () => {
  it('parses unified standard fields', () => {
    const parsed = StandardMaterialRowSchema.parse({
      materialCode: 'M001',
      materialName: '螺丝',
      specification: 'M4',
      warehouse: '原料仓',
      batchNo: 'B1',
      unit: 'PCS',
      openingQuantity: '100',
      inboundQuantity: 0,
      issuedQuantity: '10',
      returnedQuantity: '',
      scrapQuantity: 2,
      countedQuantity: '85',
      plannedQuantity: null,
      actualOutputQuantity: undefined,
      transactionDate: '2026-07-19',
      remark: 'demo',
      sourceType: 'inventory',
      sourceFile: 'a.xlsx',
      sourceSheet: '库存',
      sourceRowIndex: 0,
    });
    expect(parsed.openingQuantity).toBe(100);
    expect(parsed.issuedQuantity).toBe(10);
    expect(parsed.returnedQuantity).toBe(0);
    expect(parsed.countedQuantity).toBe(85);
  });
});

describe('input detector', () => {
  it('detects inventory / issue / scrap by headers and sheet names', () => {
    const inventory = detectSheet({
      fileName: '库存日清.xlsx',
      sheetName: '当前库存',
      headers: ['物料编码', '物料名称', '仓库', '期初库存', '实盘数量'],
      rows: [{ 物料编码: 'M1', 物料名称: 'A', 仓库: '仓1', 期初库存: 10, 实盘数量: 9 }],
    });
    expect(inventory.inputType).toBe('inventory');
    expect(inventory.needsUserConfirm).toBe(false);

    const issue = detectSheet({
      fileName: '今日领料.xlsx',
      sheetName: '领料明细',
      headers: ['物料名称', '领料数量', '仓库'],
      rows: [{ 物料名称: 'A', 领料数量: 3, 仓库: '仓1' }],
    });
    expect(issue.inputType).toBe('materialIssue');
    expect(issue.needsUserConfirm).toBe(false);

    const scrap = detectSheet({
      fileName: '废料表.xlsx',
      sheetName: '报废',
      headers: ['物料名称', '废料数量'],
      rows: [{ 物料名称: 'A', 废料数量: 1 }],
    });
    expect(scrap.inputType).toBe('scrap');
  });

  it('asks only input type when confidence is low', () => {
    const weak = detectSheet({
      fileName: 'data.xlsx',
      sheetName: 'Sheet1',
      headers: ['物料名称', '数量'],
      rows: [{ 物料名称: 'A', 数量: 1 }],
    });
    expect(weak.needsUserConfirm).toBe(true);
    expect(weak.confirmPrompt?.kind === 'inputType' || weak.confirmPrompt?.kind === 'criticalField').toBe(
      true,
    );
  });
});

describe('material daily close workflow', () => {
  it('merges inventory + issue + return + scrap without sheet picker', () => {
    const result = runMaterialDailyCloseWorkflow({
      workbooks: [
        {
          fileName: '库存.xlsx',
          sheets: [
            {
              sheetName: '当前库存',
              headers: ['物料编码', '物料名称', '仓库', '单位', '期初库存', '实盘数量'],
              rows: [
                {
                  物料编码: 'M001',
                  物料名称: '螺丝M4',
                  仓库: '原料仓',
                  单位: 'PCS',
                  期初库存: 100,
                  实盘数量: 80,
                },
              ],
            },
            {
              sheetName: '备注',
              headers: ['说明'],
              rows: [{ 说明: '忽略' }],
            },
          ],
        },
        {
          fileName: '今日领料.xlsx',
          sheets: [
            {
              sheetName: '领料',
              headers: ['物料名称', '仓库', '领料数量'],
              rows: [{ 物料名称: '螺丝M4', 仓库: '原料仓', 领料数量: 20 }],
            },
          ],
        },
        {
          fileName: '今日退料.xlsx',
          sheets: [
            {
              sheetName: '退料',
              headers: ['物料名称', '仓库', '退料数量'],
              rows: [{ 物料名称: '螺丝M4', 仓库: '原料仓', 退料数量: 5 }],
            },
          ],
        },
        {
          fileName: '废料.xlsx',
          sheets: [
            {
              sheetName: '报废',
              headers: ['物料名称', '仓库', '废料数量'],
              rows: [{ 物料名称: '螺丝M4', 仓库: '原料仓', 废料数量: 3 }],
            },
          ],
        },
      ],
    });

    expect(result.blocked).toBe(false);
    expect(result.summary.inventoryRows).toBe(1);
    expect(result.summary.issueRows).toBe(1);
    expect(result.summary.returnRows).toBe(1);
    expect(result.summary.scrapRows).toBe(1);

    const line = result.balances[0]!;
    // 100 + 0 + 5 - 20 - 3 = 82；实盘 80 → 盘亏 2
    expect(line.theoreticalQuantity).toBe(82);
    expect(line.varianceQuantity).toBe(-2);
    expect(line.replenishQuantity).toBe(2);
    expect(result.replenishTickets).toHaveLength(1);
    expect(result.scrapTickets).toHaveLength(1);
    expect(result.varianceTickets).toHaveLength(1);

    const bytes = buildTicketPackageBytes(result);
    expect(bytes.byteLength).toBeGreaterThan(500);
    const parsed = XLSX.read(bytes, { type: 'array' });
    expect(parsed.SheetNames).toEqual([
      '日清概览',
      '明细台账',
      '计算追溯',
      '补料单',
      '报废单',
      '盘点差异单',
    ]);
    expect(materialDailyCloseFileName(result.generatedAt)).toMatch(/^物料日清单据包_\d{8}\.xlsx$/);
  });

  it('supports optional production plan sheet', () => {
    const result = runMaterialDailyCloseWorkflow({
      workbooks: [
        {
          fileName: '库存.xlsx',
          sheets: [
            {
              sheetName: '库存',
              headers: ['物料名称', '期初库存', '实盘数量'],
              rows: [{ 物料名称: '垫片', 期初库存: 50, 实盘数量: 50 }],
            },
          ],
        },
        {
          fileName: '完工.xlsx',
          sheets: [
            {
              sheetName: '生产计划',
              headers: ['物料名称', '计划数量', '完工数量'],
              rows: [{ 物料名称: '垫片', 计划数量: 100, 完工数量: 80 }],
            },
          ],
        },
      ],
    });
    expect(result.blocked).toBe(false);
    expect(result.summary.planRows).toBe(1);
    expect(result.balances[0]?.plannedQuantity).toBe(100);
    expect(result.balances[0]?.actualOutputQuantity).toBe(80);
    expect(result.exceptions.some((item) => item.code === 'MATERIAL_SHORTAGE')).toBe(true);
  });

  it('blocks export until user confirms ambiguous type', () => {
    const blocked = runMaterialDailyCloseWorkflow({
      workbooks: [
        {
          fileName: 'unknown.xlsx',
          sheets: [
            {
              sheetName: 'Sheet1',
              headers: ['物料名称', '数量'],
              rows: [{ 物料名称: 'A', 数量: 1 }],
            },
          ],
        },
      ],
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.clarifications.length).toBeGreaterThan(0);
    expect(() => buildTicketPackageBytes(blocked)).toThrow(/待确认/);
  });

  it('adapts data-engine workbook shape', () => {
    const adapted = workbookToWorkflowInput({
      fileName: 'x.xlsx',
      sheets: [{ name: '库存', headers: ['物料名称', '期初库存', '实盘数量'], rows: [] }],
    });
    expect(adapted.sheets[0]?.sheetName).toBe('库存');
  });
});
