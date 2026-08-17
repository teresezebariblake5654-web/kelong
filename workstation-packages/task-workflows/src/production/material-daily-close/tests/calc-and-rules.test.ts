import { describe, expect, it } from 'vitest';
import { runMaterialCalcEngine } from '../calcEngine.js';
import { evaluateBusinessRules } from '../businessRules.js';
import { DEFAULT_ENTERPRISE_RULES } from '../enterpriseRules.js';
import { recognizeFields } from '../fieldRecognizer.js';
import { createMemoryHistoryStore, saveConfirmedMappings } from '../localHistory.js';
import { parseQuantity } from '../quantityParse.js';
import type { StandardMaterialRow } from '../types.js';

function row(partial: Partial<StandardMaterialRow> & Pick<StandardMaterialRow, 'materialName' | 'sourceType'>): StandardMaterialRow {
  return {
    materialCode: '',
    specification: '',
    warehouse: '原料仓',
    batchNo: '',
    unit: 'PCS',
    openingQuantity: 0,
    inboundQuantity: 0,
    issuedQuantity: 0,
    returnedQuantity: 0,
    scrapQuantity: 0,
    countedQuantity: null,
    plannedQuantity: 0,
    actualOutputQuantity: 0,
    transactionDate: '2026-07-19',
    remark: '',
    sourceFile: 't.xlsx',
    sourceSheet: 's',
    sourceRowIndex: 0,
    ...partial,
  };
}

describe('quantity parse', () => {
  it('handles thousands separators and signs', () => {
    expect(parseQuantity('1,200.5')).toBe(1200.5);
    expect(parseQuantity('-30')).toBe(-30);
    expect(parseQuantity('＋12')).toBe(12);
    expect(parseQuantity('')).toBe(0);
  });
});

describe('field recognition order', () => {
  it('prefers historical mapping over aliases', () => {
    const store = createMemoryHistoryStore();
    saveConfirmedMappings(store, 'org1', ['料号X', '品名X', '期初库存'], {
      materialCode: '料号X',
      materialName: '品名X',
      openingQuantity: '期初库存',
    });
    const result = recognizeFields({
      headers: ['料号X', '品名X', '期初库存', '废料数量'],
      rows: [{ 料号X: 'A', 品名X: '螺丝', 期初库存: 1, 废料数量: 0 }],
      scopeKey: 'org1',
      historyStore: store,
    });
    const code = result.matches.find((m) => m.standardField === 'materialCode');
    expect(code?.sourceColumn).toBe('料号X');
    expect(code?.method).toBe('history');
  });

  it('matches required aliases from product dictionary', () => {
    const result = recognizeFields({
      headers: ['存货编码', '存货名称', '实领数量', '返库数量', '不良数量', '实存数量', '昨日库存'],
      rows: [
        {
          存货编码: 'M1',
          存货名称: '垫片',
          实领数量: 2,
          返库数量: 1,
          不良数量: 0,
          实存数量: 9,
          昨日库存: 10,
        },
      ],
    });
    const map = Object.fromEntries(result.matches.map((m) => [m.standardField, m.sourceColumn]));
    expect(map.materialCode).toBe('存货编码');
    expect(map.materialName).toBe('存货名称');
    expect(map.issuedQuantity).toBe('实领数量');
    expect(map.returnedQuantity).toBe('返库数量');
    expect(map.scrapQuantity).toBe('不良数量');
    expect(map.countedQuantity).toBe('实存数量');
    expect(map.openingQuantity).toBe('昨日库存');
  });
});

describe('deterministic calc engine', () => {
  it('merges by materialCode+warehouse+batch and keeps source lineage', () => {
    const rows = [
      row({
        materialCode: 'M001',
        materialName: '螺丝',
        batchNo: 'B1',
        openingQuantity: 100,
        countedQuantity: 80,
        sourceType: 'inventory',
        sourceRowIndex: 0,
      }),
      row({
        materialCode: 'M001',
        materialName: '螺丝',
        batchNo: 'B1',
        issuedQuantity: 25,
        sourceType: 'materialIssue',
        sourceRowIndex: 1,
      }),
      row({
        materialCode: 'M001',
        materialName: '螺丝',
        batchNo: 'B1',
        returnedQuantity: 5,
        sourceType: 'materialReturn',
        sourceRowIndex: 2,
      }),
      row({
        materialCode: 'M001',
        materialName: '螺丝',
        batchNo: 'B1',
        scrapQuantity: 2,
        sourceType: 'scrap',
        sourceRowIndex: 3,
      }),
    ];
    const calc = runMaterialCalcEngine(rows);
    expect(calc.balances).toHaveLength(1);
    // 100 + 0 + 5 - 25 - 2 = 78
    expect(calc.balances[0]?.closingQuantity).toBe(78);
    expect(calc.balances[0]?.varianceQuantity).toBe(2);
    expect(calc.details[0]?.sourceRows).toHaveLength(4);
    expect(calc.details[0]?.mergeStrategy).toBe('code+wh+batch');
  });

  it('splits unit conflicts', () => {
    const rows = [
      row({ materialCode: 'M2', materialName: '线材', unit: 'PCS', openingQuantity: 10, sourceType: 'inventory' }),
      row({ materialCode: 'M2', materialName: '线材', unit: 'KG', issuedQuantity: 1, sourceType: 'materialIssue' }),
    ];
    const calc = runMaterialCalcEngine(rows);
    expect(calc.balances.length).toBeGreaterThanOrEqual(2);
    expect(calc.warnings.some((w) => w.includes('单位冲突'))).toBe(true);
  });
});

describe('business rules', () => {
  it('emits required rule codes', () => {
    const rows = [
      row({
        materialCode: 'M9',
        materialName: '弹簧',
        openingQuantity: 10,
        issuedQuantity: 20,
        returnedQuantity: 25,
        scrapQuantity: 5,
        countedQuantity: 1,
        plannedQuantity: 50,
        sourceType: 'inventory',
      }),
    ];
    const calc = runMaterialCalcEngine(rows);
    const exceptions = evaluateBusinessRules({
      balances: calc.balances,
      details: calc.details,
      sourceRows: rows,
      rules: { ...DEFAULT_ENTERPRISE_RULES, defaultSafetyStock: 100, scrapRatioThreshold: 0.1 },
    });
    const codes = new Set(exceptions.map((e) => e.code));
    expect(codes.has('NEGATIVE_INVENTORY') || codes.has('COUNT_DIFFERENCE')).toBe(true);
    expect(codes.has('INVALID_RETURN')).toBe(true);
    expect(codes.has('MATERIAL_SHORTAGE')).toBe(true);
    expect(codes.has('LOW_STOCK')).toBe(true);
    expect(codes.has('EXCESSIVE_SCRAP')).toBe(true);
  });
});
