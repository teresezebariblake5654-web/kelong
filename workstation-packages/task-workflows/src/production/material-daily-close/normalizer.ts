import { FIELD_DICTIONARY, type StandardFieldKey } from './fieldDictionary.js';
import { parseStandardRow } from './schemas.js';
import type {
  MaterialInputType,
  RawSheetInput,
  SheetDetectionResult,
  StandardMaterialRow,
} from './types.js';

function empty(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

function pick(
  row: Record<string, unknown>,
  matches: SheetDetectionResult['fieldMatches'],
  key: StandardFieldKey,
): unknown {
  const found = matches.find((item) => item.standardField === key);
  return found ? row[found.sourceColumn] : undefined;
}

/**
 * 将原始 Sheet 行规范化为标准字段行（Zod 校验）。
 * 按输入类型把数量写入对应标准字段，避免领料/退料串列。
 */
export function normalizeSheet(
  sheet: RawSheetInput,
  detection: SheetDetectionResult,
): { rows: StandardMaterialRow[]; errors: string[] } {
  if (!detection.inputType) {
    return { rows: [], errors: [`工作表「${sheet.sheetName}」尚未确认文件类型`] };
  }

  const inputType = detection.inputType;
  const rows: StandardMaterialRow[] = [];
  const errors: string[] = [];
  const matchMap = detection.fieldMatches;

  sheet.rows.forEach((row, index) => {
    const materialName = pick(row, matchMap, 'materialName');
    const materialCode = pick(row, matchMap, 'materialCode');
    if (empty(materialName) && empty(materialCode)) return;

    const base = {
      materialCode: pick(row, matchMap, 'materialCode'),
      materialName: pick(row, matchMap, 'materialName'),
      specification: pick(row, matchMap, 'specification'),
      warehouse: pick(row, matchMap, 'warehouse'),
      batchNo: pick(row, matchMap, 'batchNo'),
      unit: pick(row, matchMap, 'unit'),
      openingQuantity: 0,
      inboundQuantity: 0,
      issuedQuantity: 0,
      returnedQuantity: 0,
      scrapQuantity: 0,
      countedQuantity: null as number | null,
      plannedQuantity: 0,
      actualOutputQuantity: 0,
      transactionDate: pick(row, matchMap, 'transactionDate'),
      remark: pick(row, matchMap, 'remark'),
      sourceType: inputType,
      sourceFile: sheet.fileName,
      sourceSheet: sheet.sheetName,
      sourceRowIndex: index,
    };

    applyTypeQuantities(base, row, matchMap, inputType);

    const parsed = parseStandardRow(base);
    if (!parsed.ok) {
      errors.push(`「${sheet.sheetName}」第 ${index + 1} 行：${parsed.error}`);
      return;
    }

    const data = parsed.data;
    if (!data.materialName) {
      data.materialName = data.materialCode || `未命名物料#${index + 1}`;
    }
    if (!data.warehouse) data.warehouse = '默认仓';
    if (!data.unit) data.unit = 'PCS';

    rows.push(data);
  });

  return { rows, errors };
}

function applyTypeQuantities(
  base: Record<string, unknown>,
  row: Record<string, unknown>,
  matches: SheetDetectionResult['fieldMatches'],
  inputType: MaterialInputType,
) {
  const opening = pick(row, matches, 'openingQuantity');
  const inbound = pick(row, matches, 'inboundQuantity');
  const issued = pick(row, matches, 'issuedQuantity');
  const returned = pick(row, matches, 'returnedQuantity');
  const scrap = pick(row, matches, 'scrapQuantity');
  const counted = pick(row, matches, 'countedQuantity');
  const planned = pick(row, matches, 'plannedQuantity');
  const actual = pick(row, matches, 'actualOutputQuantity');

  switch (inputType) {
    case 'inventory':
      base.openingQuantity = opening ?? 0;
      base.inboundQuantity = inbound ?? 0;
      base.issuedQuantity = issued ?? 0;
      base.returnedQuantity = returned ?? 0;
      base.scrapQuantity = scrap ?? 0;
      base.countedQuantity = counted ?? null;
      break;
    case 'materialIssue':
      base.issuedQuantity = issued ?? opening ?? 0;
      break;
    case 'materialReturn':
      base.returnedQuantity = returned ?? opening ?? 0;
      break;
    case 'scrap':
      base.scrapQuantity = scrap ?? opening ?? 0;
      break;
    case 'productionPlan':
      base.plannedQuantity = planned ?? 0;
      base.actualOutputQuantity = actual ?? 0;
      break;
    default:
      break;
  }
}

export function describeFieldCoverage(detection: SheetDetectionResult): string {
  const matched = new Set(detection.fieldMatches.map((m) => m.standardField));
  const labels = FIELD_DICTIONARY.filter((f) => matched.has(f.key)).map((f) => f.label);
  return labels.join('、');
}
