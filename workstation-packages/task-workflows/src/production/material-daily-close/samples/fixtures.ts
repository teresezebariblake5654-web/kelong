import type { RawWorkbookInput } from '../types.js';

/** 标准中文表头 */
export function sampleStandardChinese(): RawWorkbookInput[] {
  return [
    {
      fileName: '标准库存.xlsx',
      sheets: [
        {
          sheetName: '当前库存',
          headers: ['物料编码', '物料名称', '规格', '仓库', '单位', '期初库存', '实盘数量', '业务日期'],
          rows: [
            {
              物料编码: 'M001',
              物料名称: '螺丝M4',
              规格: 'M4*10',
              仓库: '原料仓',
              单位: 'PCS',
              期初库存: 100,
              实盘数量: 88,
              业务日期: '2026-07-19',
            },
            {
              物料编码: 'M002',
              物料名称: '垫片',
              规格: 'Φ8',
              仓库: '原料仓',
              单位: 'PCS',
              期初库存: 50,
              实盘数量: 50,
              业务日期: '2026-07-19',
            },
          ],
        },
      ],
    },
    {
      fileName: '标准领料.xlsx',
      sheets: [
        {
          sheetName: '领料明细',
          headers: ['物料编码', '物料名称', '仓库', '领料数量', '单位'],
          rows: [{ 物料编码: 'M001', 物料名称: '螺丝M4', 仓库: '原料仓', 领料数量: 12, 单位: 'PCS' }],
        },
      ],
    },
    {
      fileName: '标准退料.xlsx',
      sheets: [
        {
          sheetName: '退料',
          headers: ['物料编码', '物料名称', '仓库', '退料数量'],
          rows: [{ 物料编码: 'M001', 物料名称: '螺丝M4', 仓库: '原料仓', 退料数量: 2 }],
        },
      ],
    },
    {
      fileName: '标准废料.xlsx',
      sheets: [
        {
          sheetName: '报废',
          headers: ['物料编码', '物料名称', '仓库', '废料数量', '备注'],
          rows: [
            {
              物料编码: 'M001',
              物料名称: '螺丝M4',
              仓库: '原料仓',
              废料数量: 1,
              备注: '加工损坏需报废',
            },
          ],
        },
      ],
    },
  ];
}

/** 不同别名表头 */
export function sampleAliasHeaders(): RawWorkbookInput[] {
  return [
    {
      fileName: '别名库存.xls',
      sheets: [
        {
          sheetName: '库存',
          headers: ['料号', '品名', '仓位', '期初数', '盘点数', '计量单位'],
          rows: [{ 料号: 'A100', 品名: '轴承', 仓位: 'A仓', 期初数: 20, 盘点数: 18, 计量单位: '个' }],
        },
      ],
    },
    {
      fileName: '出库单.csv',
      sheets: [
        {
          sheetName: 'Sheet1',
          headers: ['料号', '品名', '仓位', '出库数量'],
          rows: [{ 料号: 'A100', 品名: '轴承', 仓位: 'A仓', 出库数量: 3 }],
        },
      ],
    },
  ];
}

/** 多 Sheet */
export function sampleMultiSheet(): RawWorkbookInput {
  return {
    fileName: '多表.xlsx',
    sheets: [
      {
        sheetName: '说明',
        headers: ['备注'],
        rows: [{ 备注: '忽略此页' }],
      },
      {
        sheetName: '当前库存',
        headers: ['物料编码', '物料名称', '仓库', '期初库存'],
        rows: [{ 物料编码: 'S1', 物料名称: '钢片', 仓库: '一仓', 期初库存: 40 }],
      },
      {
        sheetName: '今日领料',
        headers: ['物料编码', '物料名称', '仓库', '领料数量'],
        rows: [{ 物料编码: 'S1', 物料名称: '钢片', 仓库: '一仓', 领料数量: 5 }],
      },
    ],
  };
}

/** 多仓库 + 多批次 */
export function sampleMultiWarehouseBatch(): RawWorkbookInput[] {
  return [
    {
      fileName: '多仓批次.xlsx',
      sheets: [
        {
          sheetName: '库存',
          headers: ['物料编码', '物料名称', '仓库', '批次号', '期初库存', '单位'],
          rows: [
            { 物料编码: 'B1', 物料名称: '树脂', 仓库: '原料仓', 批次号: 'LOT-01', 期初库存: 30, 单位: 'KG' },
            { 物料编码: 'B1', 物料名称: '树脂', 仓库: '原料仓', 批次号: 'LOT-02', 期初库存: 10, 单位: 'KG' },
            { 物料编码: 'B1', 物料名称: '树脂', 仓库: '线边仓', 批次号: 'LOT-01', 期初库存: 5, 单位: 'KG' },
          ],
        },
      ],
    },
    {
      fileName: '领料.xlsx',
      sheets: [
        {
          sheetName: '领料',
          headers: ['物料编码', '物料名称', '仓库', '批次号', '领料数量'],
          rows: [
            { 物料编码: 'B1', 物料名称: '树脂', 仓库: '原料仓', 批次号: 'LOT-01', 领料数量: 8 },
            { 物料编码: 'B1', 物料名称: '树脂', 仓库: '线边仓', 批次号: 'LOT-01', 领料数量: 2 },
          ],
        },
      ],
    },
  ];
}

/** 单位冲突 / 重复交易 / 负库存 / 缺料 / 报废异常 / 模糊备注 */
export function sampleExceptionScenarios(): RawWorkbookInput[] {
  return [
    {
      fileName: '异常库存.xlsx',
      sheets: [
        {
          sheetName: '库存',
          headers: ['物料编码', '物料名称', '仓库', '单位', '期初库存', '实盘数量', '计划数量'],
          rows: [
            {
              物料编码: 'E1',
              物料名称: '铜线',
              仓库: '主仓',
              单位: 'KG',
              期初库存: 5,
              实盘数量: 1,
              计划数量: 20,
            },
            {
              物料编码: 'E2',
              物料名称: '铜线',
              仓库: '主仓',
              单位: 'G',
              期初库存: 1000,
              实盘数量: 900,
              计划数量: 0,
            },
          ],
        },
      ],
    },
    {
      fileName: '异常领料.xlsx',
      sheets: [
        {
          sheetName: '领料',
          headers: ['物料编码', '物料名称', '仓库', '单位', '领料数量'],
          rows: [
            { 物料编码: 'E1', 物料名称: '铜线', 仓库: '主仓', 单位: 'KG', 领料数量: 10 },
            { 物料编码: 'E1', 物料名称: '铜线', 仓库: '主仓', 单位: 'KG', 领料数量: 10 },
          ],
        },
      ],
    },
    {
      fileName: '异常废料.xlsx',
      sheets: [
        {
          sheetName: '废料',
          headers: ['物料编码', '物料名称', '仓库', '废料数量', '备注'],
          rows: [
            {
              物料编码: 'E1',
              物料名称: '铜线',
              仓库: '主仓',
              废料数量: 4,
              备注: '好像有点问题，看着不太对',
            },
          ],
        },
      ],
    },
  ];
}

/** 一万行以上性能样例（库存 + 领料双表） */
export function samplePerformance10k(rowCount = 10000): RawWorkbookInput[] {
  const invHeaders = ['物料编码', '物料名称', '仓库', '单位', '期初库存'];
  const issueHeaders = ['物料编码', '物料名称', '仓库', '单位', '领料数量'];
  const invRows: Array<Record<string, unknown>> = [];
  const issueRows: Array<Record<string, unknown>> = [];
  const materials = Math.min(500, Math.ceil(rowCount / 20));
  for (let i = 0; i < materials; i++) {
    invRows.push({
      物料编码: `P${i + 1}`,
      物料名称: `物料${i + 1}`,
      仓库: `仓${(i % 5) + 1}`,
      单位: 'PCS',
      期初库存: 100 + (i % 20),
    });
  }
  for (let i = 0; i < rowCount; i++) {
    const mid = (i % materials) + 1;
    issueRows.push({
      物料编码: `P${mid}`,
      物料名称: `物料${mid}`,
      仓库: `仓${(mid % 5) + 1}`,
      单位: 'PCS',
      领料数量: (i % 7) + 1,
    });
  }
  return [
    {
      fileName: `perf_inv_${materials}.xlsx`,
      sheets: [{ sheetName: '当前库存', headers: invHeaders, rows: invRows }],
    },
    {
      fileName: `perf_issue_${rowCount}.xlsx`,
      sheets: [{ sheetName: '今日领料', headers: issueHeaders, rows: issueRows }],
    },
  ];
}
