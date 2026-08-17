import { describe, expect, it } from 'vitest';
import {
  ProductionWorkflowRegistry,
  buildProductionDeliverables,
  runProductionWorkflow,
} from '../../index.js';

describe('Phase P2 production_plan_close', () => {
  it('classifies todo/delayed/blocked/done and exports five files', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const result = runProductionWorkflow('production_plan_close', {
      workbooks: [
        {
          fileName: '生产计划工单.xlsx',
          sheets: [
            {
              sheetName: '工单',
              headers: ['工单号', '产品', '产线', '计划数量', '完成数量', '在制数量', '计划完成日', '状态', '阻塞原因'],
              rows: [
                {
                  工单号: 'WO1',
                  产品: 'A',
                  产线: 'L1',
                  计划数量: 100,
                  完成数量: 40,
                  在制数量: 10,
                  计划完成日: yesterday,
                  状态: '进行中',
                  阻塞原因: '',
                },
                {
                  工单号: 'WO2',
                  产品: 'B',
                  产线: 'L1',
                  计划数量: 50,
                  完成数量: 50,
                  在制数量: 0,
                  计划完成日: yesterday,
                  状态: '已完成',
                  阻塞原因: '',
                },
                {
                  工单号: 'WO3',
                  产品: 'C',
                  产线: 'L2',
                  计划数量: 80,
                  完成数量: 10,
                  在制数量: 5,
                  计划完成日: yesterday,
                  状态: '阻塞',
                  阻塞原因: '缺料待料',
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.blocked).toBe(false);
    expect(result.summary.delayedCount).toBeGreaterThanOrEqual(1);
    expect(result.summary.blockedCount).toBeGreaterThanOrEqual(1);
    expect(result.summary.doneToCloseCount).toBeGreaterThanOrEqual(1);
    const files = buildProductionDeliverables('production_plan_close', result);
    expect(files).toHaveLength(5);
    expect(files.map((f) => f.fileName).join('|')).toMatch(/今日待完成|延期|阻塞|已完成待关闭|进度调整/);
  });
});

describe('Phase P3 output_attainment_close', () => {
  it('computes attainment rate and gap tickets', () => {
    const result = runProductionWorkflow('output_attainment_close', {
      workbooks: [
        {
          fileName: '产量达成.xlsx',
          sheets: [
            {
              sheetName: '报工',
              headers: ['工单号', '产品', '产线', '班组', '计划产量', '实际产量'],
              rows: [
                { 工单号: 'W1', 产品: 'A', 产线: 'L1', 班组: '甲', 计划产量: 100, 实际产量: 95 },
                { 工单号: 'W2', 产品: 'B', 产线: 'L1', 班组: '乙', 计划产量: 100, 实际产量: 70 },
              ],
            },
          ],
        },
      ],
    });
    expect(result.summary.missedCount).toBe(1);
    const detail = result.tables.detail ?? [];
    expect(Number(detail.find((r) => r['工单号'] === 'W1')!['达成率'])).toBeCloseTo(0.95, 5);
    expect(buildProductionDeliverables('output_attainment_close', result)).toHaveLength(4);
  });
});

describe('Phase P4 quality_exception_close', () => {
  it('flags high defect rate and builds five quality deliverables', () => {
    const result = runProductionWorkflow('quality_exception_close', {
      workbooks: [
        {
          fileName: '质检不良.xlsx',
          sheets: [
            {
              sheetName: '质检',
              headers: ['批次', '产品', '产线', '检验数量', '不良数量', '缺陷类型', '报废数量', '返工数量', '备注'],
              rows: [
                {
                  批次: 'B1',
                  产品: 'A',
                  产线: 'L1',
                  检验数量: 100,
                  不良数量: 8,
                  缺陷类型: '尺寸超差',
                  报废数量: 2,
                  返工数量: 6,
                  备注: '尺寸不良需返工',
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.exceptions.some((e) => e.code === 'HIGH_DEFECT_RATE')).toBe(true);
    expect(buildProductionDeliverables('quality_exception_close', result)).toHaveLength(5);
  });
});

describe('Phase P5 downtime_loss_close', () => {
  it('computes lost output from takt and exports five files', () => {
    const result = runProductionWorkflow('downtime_loss_close', {
      workbooks: [
        {
          fileName: '停机记录.xlsx',
          sheets: [
            {
              sheetName: '停机',
              headers: ['设备', '产线', '停机原因', '停机分钟', '标准节拍', '日期'],
              rows: [
                { 设备: '压机1', 产线: 'L1', 停机原因: '设备故障需维修', 停机分钟: 90, 标准节拍: 30, 日期: '2026-07-19' },
                { 设备: '压机1', 产线: 'L1', 停机原因: '设备故障再次发生', 停机分钟: 20, 标准节拍: 30, 日期: '2026-07-19' },
              ],
            },
          ],
        },
      ],
    });
    // 90*60/30 = 180
    const loss = result.tables.loss?.[0];
    expect(loss?.['损失产量']).toBe(180);
    expect(result.exceptions.some((e) => e.code === 'LONG_DOWNTIME')).toBe(true);
    expect(buildProductionDeliverables('downtime_loss_close', result)).toHaveLength(5);
  });
});

describe('ProductionWorkflowRegistry', () => {
  it('registers six enabled closing workflows', () => {
    const list = ProductionWorkflowRegistry.list();
    expect(list).toHaveLength(6);
    expect(list.map((d) => d.taskCode).sort()).toEqual(
      [
        'downtime_loss_close',
        'material_daily_close',
        'material_variance_close',
        'output_attainment_close',
        'production_plan_close',
        'quality_exception_close',
      ].sort(),
    );
  });
});
