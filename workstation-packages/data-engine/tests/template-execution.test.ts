import { describe, expect, it } from 'vitest';
import { dataEngine, type DataRow, type SheetData } from '../src/index.js';

function makeSheet(headers: string[], rows: DataRow[]): SheetData {
  return { name: '数据', headers, rows, columnProfiles: dataEngine.inferColumnTypes(rows, headers) };
}

describe('template execution', () => {
  it('executes HR aliases, aggregates and anomaly rules', () => {
    const sheet = makeSheet(
      ['所属部门', '姓名', '考勤日期', '出勤状态', '迟到分钟'],
      [
        { 所属部门: '研发', 姓名: '张三', 考勤日期: '2026-07-01', 出勤状态: '正常', 迟到分钟: 0 },
        { 所属部门: '研发', 姓名: '李四', 考勤日期: '2026-07-01', 出勤状态: '缺勤', 迟到分钟: 0 },
        { 所属部门: '销售', 姓名: '王五', 考勤日期: '2026-07-01', 出勤状态: '迟到', 迟到分钟: 45 },
      ],
    );
    const result = dataEngine.executeTemplate({ templateCode: 'HR_ATTENDANCE_SUMMARY', sheet });

    expect(result.matchedColumns).toHaveLength(5);
    expect(result.unmatchedColumns).toHaveLength(0);
    expect(result.cleanedRows[0]).toMatchObject({ department: '研发', employee: '张三', minutes: 0 });
    expect(result.statistics.aggregates).toMatchObject({ recordCount: 3, abnormalMinutes: 45 });
    expect(result.statistics.groups).toHaveLength(3);
    expect(result.anomalies.map((item) => item.ruleCode)).toEqual(expect.arrayContaining(['ABSENCE', 'LATE_LONG']));
  });

  it('executes sales statistics and anomaly rules', () => {
    const sheet = makeSheet(
      ['业务员', '大区', '商品', '成交额', '订单号'],
      [
        { 业务员: '甲', 大区: '华东', 商品: 'A', 成交额: '1,200', 订单号: 'S1' },
        { 业务员: '乙', 大区: '华南', 商品: 'B', 成交额: -50, 订单号: 'S2' },
      ],
    );
    const result = dataEngine.executeTemplate({ templateCode: 'SALES_PERFORMANCE_SUMMARY', sheet });

    expect(result.statistics.aggregates.salesAmount).toBe(1150);
    expect(result.statistics.aggregates.orderCount).toBe(2);
    expect(result.cleanedRows[0]?.amount).toBe(1200);
    expect(result.anomalies).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: 'NEGATIVE_SALE', field: 'amount', rowIndex: 1 }),
    ]));
  });

  it('executes production derivation and low-output rules', () => {
    const sheet = makeSheet(
      ['生产线', '产品名称', '报工日期', '计划数', '实际产量'],
      [
        { 生产线: '一线', 产品名称: 'A', 报工日期: '2026-07-01', 计划数: 100, 实际产量: 80 },
        { 生产线: '二线', 产品名称: 'B', 报工日期: '2026-07-01', 计划数: 100, 实际产量: 100 },
      ],
    );
    const result = dataEngine.executeTemplate({ templateCode: 'PRODUCTION_OUTPUT_ATTAINMENT_CLOSE', sheet });

    expect(result.cleanedRows.map((row) => row.achievementRate)).toEqual([0.8, 1]);
    expect(result.cleanedRows.reduce((sum, row) => sum + Number(row.actualOutput ?? 0), 0)).toBe(180);
    expect(result.anomalies).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: 'LOW_OUTPUT', value: 0.8 }),
    ]));
  });

  it('executes logistics date calculations and delay rules', () => {
    const sheet = makeSheet(
      ['物流单号', '物流商', '物流状态', '预计送达', '签收日期'],
      [
        { 物流单号: 'L1', 物流商: '迅捷', 物流状态: '已签收', 预计送达: '2026-07-01', 签收日期: '2026-07-03' },
        { 物流单号: 'L2', 物流商: '迅捷', 物流状态: '已签收', 预计送达: '2026-07-02', 签收日期: '2026-07-02' },
      ],
    );
    const result = dataEngine.executeTemplate({ templateCode: 'LOGISTICS_DELAY_SUMMARY', sheet });

    expect(result.cleanedRows.map((row) => row.delayDays)).toEqual([2, 0]);
    expect(result.statistics.aggregates.shipmentCount).toBe(2);
    expect(result.anomalies).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: 'SHIPMENT_LATE', value: 2 }),
    ]));
  });

  it('reports universal ambiguous and type diagnostics', () => {
    const sheet = makeSheet(
      ['ID', '主键', '必填字段', '业务日期'],
      [
        { ID: 'R1', 主键: 'R1-copy', 必填字段: '有效', 业务日期: '2026-07-01' },
        { ID: 'R1', 主键: 'R1-copy', 必填字段: '', 业务日期: 'bad-date' },
      ],
    );
    const result = dataEngine.executeTemplate({ templateCode: 'UNIVERSAL_DATA_QUALITY', sheet });

    expect(result.ambiguousColumns).toEqual([
      expect.objectContaining({ fieldKey: 'recordId', candidateColumns: ['ID', '主键'] }),
    ]);
    expect(result.warnings.map((item) => item.code)).toEqual(expect.arrayContaining([
      'AMBIGUOUS_FIELD',
      'TYPE_MISMATCH',
    ]));
  });

  it('executes universal duplicate and missing rules', () => {
    const sheet = makeSheet(
      ['ID', '必填字段', '业务日期'],
      [
        { ID: 'R1', 必填字段: '有效', 业务日期: '2026-07-01' },
        { ID: 'R1', 必填字段: '', 业务日期: '2026-07-02' },
        { ID: 'R2', 必填字段: '有效', 业务日期: '2026-07-03' },
      ],
    );
    const result = dataEngine.executeTemplate({ templateCode: 'UNIVERSAL_DATA_QUALITY', sheet });

    expect(result.statistics.duplicateRowsRemoved).toBe(1);
    expect(result.cleanedRows).toHaveLength(2);
    expect(result.anomalies.map((item) => item.ruleCode)).toEqual(expect.arrayContaining([
      'DUPLICATE_RECORD',
      'REQUIRED_MISSING',
    ]));
  });
});
