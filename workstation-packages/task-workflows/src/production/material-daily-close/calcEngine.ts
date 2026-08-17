import { MaterialDailyBalanceLineSchema } from './schemas.js';
import { nearlyEqual, parseQuantity, roundQty } from './quantityParse.js';
import type {
  MaterialCalcDetail,
  MaterialDailyBalanceLine,
  SourceLineRef,
  StandardMaterialRow,
} from './types.js';

const EPS = 1e-9;

export type CalcEngineResult = {
  balances: MaterialDailyBalanceLine[];
  details: MaterialCalcDetail[];
  warnings: string[];
};

/**
 * 合并键优先：
 * 1) materialCode + warehouse + batchNo（有批次）
 * 2) materialCode + warehouse（无批次）
 * 无编码时退化为 materialName + warehouse[+batch]，并在明细中标记
 */
export function buildMergeKey(row: {
  materialCode: string;
  materialName: string;
  warehouse: string;
  batchNo: string;
}): { key: string; strategy: 'code+wh+batch' | 'code+wh' | 'name+wh+batch' | 'name+wh' } {
  const warehouse = (row.warehouse || '默认仓').trim().toLowerCase();
  const batch = (row.batchNo || '').trim().toLowerCase();
  const code = (row.materialCode || '').trim().toLowerCase();
  const name = (row.materialName || '').trim().toLowerCase();

  if (code) {
    if (batch) return { key: `c:${code}|w:${warehouse}|b:${batch}`, strategy: 'code+wh+batch' };
    return { key: `c:${code}|w:${warehouse}`, strategy: 'code+wh' };
  }
  if (batch) return { key: `n:${name}|w:${warehouse}|b:${batch}`, strategy: 'name+wh+batch' };
  return { key: `n:${name}|w:${warehouse}`, strategy: 'name+wh' };
}

function normalizeUnit(unit: string): string {
  return unit.trim().toUpperCase() || 'PCS';
}

function sourceRef(row: StandardMaterialRow): SourceLineRef {
  return {
    sourceFile: row.sourceFile,
    sourceSheet: row.sourceSheet,
    sourceRowIndex: row.sourceRowIndex,
    sourceType: row.sourceType,
  };
}

/**
 * 确定性物料计算引擎 — 禁止 AI 计算数量。
 *
 * closingQuantity =
 *   openingQuantity + inboundQuantity + returnedQuantity - issuedQuantity - scrapQuantity
 */
export function runMaterialCalcEngine(
  rows: StandardMaterialRow[],
  options?: { quantityTolerance?: number },
): CalcEngineResult {
  const tolerance = options?.quantityTolerance ?? 0.001;
  const warnings: string[] = [];

  // 同名同仓回填编码，避免「库存有编码、领料无编码」拆成两行
  const codeByNameWh = new Map<string, string>();
  for (const row of rows) {
    if (!row.materialCode || !row.materialName) continue;
    const k = `${row.materialName.trim().toLowerCase()}||${(row.warehouse || '默认仓').trim().toLowerCase()}`;
    if (!codeByNameWh.has(k)) codeByNameWh.set(k, row.materialCode);
  }
  const normalizedRows = rows.map((row) => {
    if (row.materialCode || !row.materialName) return row;
    const k = `${row.materialName.trim().toLowerCase()}||${(row.warehouse || '默认仓').trim().toLowerCase()}`;
    const code = codeByNameWh.get(k);
    return code ? { ...row, materialCode: code } : row;
  });

  const groups = new Map<
    string,
    {
      seed: StandardMaterialRow;
      openingQuantity: number;
      inboundQuantity: number;
      issuedQuantity: number;
      returnedQuantity: number;
      scrapQuantity: number;
      countedQuantity: number | null;
      plannedQuantity: number;
      actualOutputQuantity: number;
      units: Set<string>;
      codes: Set<string>;
      names: Set<string>;
      sources: SourceLineRef[];
      dates: string[];
      remarks: string[];
      mergeStrategy: string;
      fingerprintCounts: Map<string, number>;
    }
  >();

  for (const row of normalizedRows) {
    const { key, strategy } = buildMergeKey(row);
    const unit = normalizeUnit(row.unit);
    const existing = groups.get(key);

    if (!existing) {
      const fp = transactionFingerprint(row);
      groups.set(key, {
        seed: row,
        openingQuantity: row.openingQuantity,
        inboundQuantity: row.inboundQuantity,
        issuedQuantity: row.issuedQuantity,
        returnedQuantity: row.returnedQuantity,
        scrapQuantity: row.scrapQuantity,
        countedQuantity: row.countedQuantity,
        plannedQuantity: row.plannedQuantity,
        actualOutputQuantity: row.actualOutputQuantity,
        units: new Set([unit]),
        codes: new Set(row.materialCode ? [row.materialCode] : []),
        names: new Set(row.materialName ? [row.materialName] : []),
        sources: [sourceRef(row)],
        dates: row.transactionDate ? [row.transactionDate] : [],
        remarks: row.remark ? [row.remark] : [],
        mergeStrategy: strategy,
        fingerprintCounts: new Map([[fp, 1]]),
      });
      continue;
    }

    // 单位冲突：不合并数量，拆到独立 key
    if (!existing.units.has(unit) && existing.units.size > 0) {
      const conflictKey = `${key}|u:${unit}`;
      if (!groups.has(conflictKey)) {
        groups.set(conflictKey, {
          seed: row,
          openingQuantity: row.openingQuantity,
          inboundQuantity: row.inboundQuantity,
          issuedQuantity: row.issuedQuantity,
          returnedQuantity: row.returnedQuantity,
          scrapQuantity: row.scrapQuantity,
          countedQuantity: row.countedQuantity,
          plannedQuantity: row.plannedQuantity,
          actualOutputQuantity: row.actualOutputQuantity,
          units: new Set([unit]),
          codes: new Set(row.materialCode ? [row.materialCode] : []),
          names: new Set(row.materialName ? [row.materialName] : []),
          sources: [sourceRef(row)],
          dates: row.transactionDate ? [row.transactionDate] : [],
          remarks: row.remark ? [row.remark] : [],
          mergeStrategy: `${strategy}+unitSplit`,
          fingerprintCounts: new Map([[transactionFingerprint(row), 1]]),
        });
        warnings.push(
          `单位冲突已拆分：${row.materialCode || row.materialName} ${[...existing.units][0]} vs ${unit}`,
        );
      } else {
        accumulate(groups.get(conflictKey)!, row);
      }
      continue;
    }

    accumulate(existing, row);
  }

  const balances: MaterialDailyBalanceLine[] = [];
  const details: MaterialCalcDetail[] = [];

  for (const group of groups.values()) {
    const closingQuantity = roundQty(
      group.openingQuantity +
        group.inboundQuantity +
        group.returnedQuantity -
        group.issuedQuantity -
        group.scrapQuantity,
    );
    const countedQuantity = group.countedQuantity;
    const varianceQuantity =
      countedQuantity === null ? null : roundQty(countedQuantity - closingQuantity);
    const replenishQuantity =
      varianceQuantity !== null && varianceQuantity < -(tolerance || EPS)
        ? roundQty(Math.abs(varianceQuantity))
        : 0;

    const unit = [...group.units][0] || 'PCS';
    const duplicateCount = [...group.fingerprintCounts.values()].filter((n) => n > 1).reduce((s, n) => s + (n - 1), 0);

    const candidate = {
      materialCode: group.seed.materialCode || [...group.codes][0] || '',
      materialName: group.seed.materialName || [...group.names][0] || '未命名物料',
      specification: group.seed.specification,
      warehouse: group.seed.warehouse || '默认仓',
      batchNo: group.seed.batchNo,
      unit,
      openingQuantity: roundQty(group.openingQuantity),
      inboundQuantity: roundQty(group.inboundQuantity),
      issuedQuantity: roundQty(group.issuedQuantity),
      returnedQuantity: roundQty(group.returnedQuantity),
      scrapQuantity: roundQty(group.scrapQuantity),
      theoreticalQuantity: closingQuantity,
      closingQuantity,
      countedQuantity,
      varianceQuantity:
        varianceQuantity !== null && nearlyEqual(varianceQuantity, 0, tolerance) ? 0 : varianceQuantity,
      replenishQuantity,
      plannedQuantity: roundQty(group.plannedQuantity),
      actualOutputQuantity: roundQty(group.actualOutputQuantity),
      transactionDate: group.dates[0] ?? '',
      remark: group.remarks.slice(0, 3).join('；'),
    };

    const parsed = MaterialDailyBalanceLineSchema.safeParse(candidate);
    if (!parsed.success) {
      warnings.push(`结存行校验失败：${candidate.materialName} ${parsed.error.message}`);
      continue;
    }
    balances.push(parsed.data);

    details.push({
      recordCode: `BAL-${balances.length}`,
      mergeKey: buildMergeKey(group.seed).key,
      mergeStrategy: group.mergeStrategy,
      materialCode: parsed.data.materialCode,
      materialName: parsed.data.materialName,
      warehouse: parsed.data.warehouse,
      batchNo: parsed.data.batchNo,
      unit: parsed.data.unit,
      openingQuantity: parsed.data.openingQuantity,
      inboundQuantity: parsed.data.inboundQuantity,
      issuedQuantity: parsed.data.issuedQuantity,
      returnedQuantity: parsed.data.returnedQuantity,
      scrapQuantity: parsed.data.scrapQuantity,
      closingQuantity: parsed.data.closingQuantity ?? closingQuantity,
      countedQuantity: parsed.data.countedQuantity,
      varianceQuantity: parsed.data.varianceQuantity,
      plannedQuantity: parsed.data.plannedQuantity,
      sourceRows: group.sources,
      duplicateSourceCount: duplicateCount,
      unitCandidates: [...group.units],
      materialCodeCandidates: [...group.codes],
      materialNameCandidates: [...group.names],
    });
  }

  balances.sort((a, b) => a.materialName.localeCompare(b.materialName, 'zh-CN'));
  return { balances, details, warnings };
}

function accumulate(
  existing: {
    seed: StandardMaterialRow;
    openingQuantity: number;
    inboundQuantity: number;
    issuedQuantity: number;
    returnedQuantity: number;
    scrapQuantity: number;
    countedQuantity: number | null;
    plannedQuantity: number;
    actualOutputQuantity: number;
    units: Set<string>;
    codes: Set<string>;
    names: Set<string>;
    sources: SourceLineRef[];
    dates: string[];
    remarks: string[];
    fingerprintCounts: Map<string, number>;
  },
  row: StandardMaterialRow,
) {
  if (row.sourceType === 'inventory') {
    existing.openingQuantity = roundQty(existing.openingQuantity + row.openingQuantity);
    if (row.countedQuantity !== null) {
      existing.countedQuantity =
        existing.countedQuantity === null
          ? row.countedQuantity
          : roundQty(existing.countedQuantity + row.countedQuantity);
    }
  }
  existing.inboundQuantity = roundQty(existing.inboundQuantity + row.inboundQuantity);
  existing.issuedQuantity = roundQty(existing.issuedQuantity + row.issuedQuantity);
  existing.returnedQuantity = roundQty(existing.returnedQuantity + row.returnedQuantity);
  existing.scrapQuantity = roundQty(existing.scrapQuantity + row.scrapQuantity);
  existing.plannedQuantity = roundQty(existing.plannedQuantity + row.plannedQuantity);
  existing.actualOutputQuantity = roundQty(existing.actualOutputQuantity + row.actualOutputQuantity);
  existing.units.add(normalizeUnit(row.unit));
  if (row.materialCode) existing.codes.add(row.materialCode);
  if (row.materialName) existing.names.add(row.materialName);
  existing.sources.push(sourceRef(row));
  if (row.transactionDate) existing.dates.push(row.transactionDate);
  if (row.remark) existing.remarks.push(row.remark);
  if (!existing.seed.materialCode && row.materialCode) {
    existing.seed = { ...existing.seed, materialCode: row.materialCode };
  }
  const fp = transactionFingerprint(row);
  existing.fingerprintCounts.set(fp, (existing.fingerprintCounts.get(fp) ?? 0) + 1);
}

function transactionFingerprint(row: StandardMaterialRow): string {
  return [
    row.sourceType,
    row.materialCode,
    row.materialName,
    row.warehouse,
    row.batchNo,
    row.unit,
    row.openingQuantity,
    row.inboundQuantity,
    row.issuedQuantity,
    row.returnedQuantity,
    row.scrapQuantity,
    row.countedQuantity ?? '',
    row.transactionDate,
  ].join('|');
}

/** 供外部解析数量字符串（千分位/正负号） */
export { parseQuantity };
