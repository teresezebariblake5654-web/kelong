import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  aggregateRows,
  createFileRuleStore,
  createWorkflowRuntime,
  deriveRows,
  executeWorkflow,
  joinRows,
  normalizeSignedQuantityRows,
  roundQty,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

function nearly(a: number, b: number, digits = 6) {
  expect(roundQty(a, digits)).toBe(roundQty(b, digits));
}

describe('reusable operators', () => {
  it('supports full join, aggregate and derive', () => {
    const joined = joinRows({
      left: [{ workOrderNo: 'WO-1', materialCode: 'M1', standardQty: 10 }],
      right: [{ workOrderNo: 'WO-1', materialCode: 'M2', actualQty: 3 }],
      keys: ['workOrderNo', 'materialCode'],
      joinType: 'full',
    });
    expect(joined).toHaveLength(2);

    const signed = normalizeSignedQuantityRows([
      { movementType: '领料', qty: 10 },
      { movementType: '退料', qty: 2 },
    ]);
    const agg = aggregateRows(signed, {
      groupBy: [],
      metrics: {
        issueQty: { field: 'issueQty', op: 'sum' },
        returnQty: { field: 'returnQty', op: 'sum' },
      },
    });
    // empty groupBy → one group with key ''
    expect(agg[0]?.issueQty).toBe(10);
    expect(agg[0]?.returnQty).toBe(2);

    const derived = deriveRows([{ goodQty: 100, unitUsage: 2, lossRate: 0.05 }], {
      standardQty: 'goodQty * unitUsage * (1 + lossRate)',
    });
    nearly(Number(derived[0]?.standardQty), 210);
  });
});

describe('PROD-CONSUMPTION-CHECK-002 unit cases', () => {
  async function runCase(options: {
    bom: unknown[][];
    output: unknown[][];
    issue: unknown[][];
    rules?: Record<string, unknown>;
    companyId?: string;
    persisted?: Record<string, unknown>;
    rootDir?: string;
  }) {
    const dir = options.rootDir ?? mkdtempSync(join(tmpdir(), 'aw-cc-'));
    const bomPath = join(dir, 'bom.xlsx');
    const outputPath = join(dir, 'output.xlsx');
    const issuePath = join(dir, 'issue.xlsx');
    const outputDir = join(dir, 'out');
    writeSheet(bomPath, options.bom);
    writeSheet(outputPath, options.output);
    writeSheet(issuePath, options.issue);

    const persistedRuleStore = createFileRuleStore({ rootDir: dir });
    if (options.companyId && options.persisted) {
      await persistedRuleStore.saveWorkflowRules(
        options.companyId,
        'PROD-CONSUMPTION-CHECK-002',
        options.persisted,
      );
    }

    const runtime = createWorkflowRuntime({ persistedRuleStore });
    const result = await runtime.execute({
      workflowId: 'PROD-CONSUMPTION-CHECK-002',
      companyId: options.companyId,
      rules: options.rules,
      inputFiles: [
        { role: 'bom', path: bomPath },
        { role: 'production_output', path: outputPath },
        { role: 'material_issue', path: issuePath },
      ],
      outputDir,
      runDate: '2026-07-22',
    });
    return { result, outputDir, dir };
  }

  it('1-4: normal usage with return, default and BOM loss rate priority', async () => {
    const { result } = await runCase({
      bom: [
        ['产品编码', '物料编码', '物料名称', '单位耗用', '损耗率'],
        ['P-100', 'M-001', '钢板', 2, '5%'],
      ],
      output: [
        ['工单号', '产品编码', '合格产量'],
        ['WO-001', 'P-100', 100],
      ],
      issue: [
        ['工单号', '物料编码', '类型', '数量'],
        ['WO-001', 'M-001', '领料', 220],
        ['WO-001', 'M-001', '退料', 5],
      ],
      rules: { overuseToleranceRate: 0.1, underuseToleranceRate: 0.1 },
    });

    expect(result.errorMessage).toBeUndefined();
    const workbook = XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' });
    const daily = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['工单耗用核对']!);
    const row = daily.find((item) => item.materialCode === 'M-001');
    nearly(Number(row!.standardQty), 210);
    nearly(Number(row!.actualQty), 215);
    nearly(Number(row!.varianceQty), 5);
    nearly(Number(row!.varianceRate), 5 / 210);

    // default loss rate when BOM omits lossRate
    const { result: resultDefault } = await runCase({
      bom: [
        ['productCode', 'materialCode', 'unitUsage'],
        ['P-100', 'M-001', 2],
      ],
      output: [
        ['workOrderNo', 'productCode', 'goodQty'],
        ['WO-001', 'P-100', 100],
      ],
      issue: [
        ['workOrderNo', 'materialCode', 'movementType', 'qty'],
        ['WO-001', 'M-001', 'issue', 200],
      ],
      rules: { defaultLossRate: 0.1, overuseToleranceRate: 1, underuseToleranceRate: 1 },
    });
    const wb2 = XLSX.read(readFileSync(resultDefault.outputFiles[0]!), { type: 'buffer' });
    const rows2 = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb2.Sheets['工单耗用核对']!);
    nearly(Number(rows2[0]!.standardQty), 220); // 100*2*1.1
  });

  it('5-6: overuse and underuse', async () => {
    const over = await runCase({
      bom: [
        ['产品编码', '物料编码', '单位耗用', '损耗率'],
        ['P-100', 'M-001', 2, 0],
      ],
      output: [
        ['工单号', '产品编码', '合格产量'],
        ['WO-001', 'P-100', 100],
      ],
      issue: [
        ['工单号', '物料编码', '类型', '数量'],
        ['WO-001', 'M-001', '生产领用', 240],
      ],
      rules: { overuseToleranceRate: 0.05, underuseToleranceRate: 0.05 },
    });
    expect(over.result.metrics.overuseCount).toBeGreaterThan(0);

    const under = await runCase({
      bom: [
        ['产品编码', '物料编码', '单位耗用', '损耗率'],
        ['P-100', 'M-001', 2, 0],
      ],
      output: [
        ['工单号', '产品编码', '合格产量'],
        ['WO-001', 'P-100', 100],
      ],
      issue: [
        ['工单号', '物料编码', '类型', '数量'],
        ['WO-001', 'M-001', '领料', 100],
      ],
      rules: { overuseToleranceRate: 0.05, underuseToleranceRate: 0.05 },
    });
    expect(under.result.metrics.underuseCount).toBeGreaterThan(0);
  });

  it('7-9: wrong material, missing actual, missing BOM', async () => {
    const wrong = await runCase({
      bom: [
        ['产品编码', '物料编码', '单位耗用'],
        ['P-100', 'M-001', 1],
      ],
      output: [
        ['工单号', '产品编码', '合格产量'],
        ['WO-001', 'P-100', 10],
      ],
      issue: [
        ['工单号', '物料编码', '类型', '数量'],
        ['WO-001', 'M-001', '领料', 10],
        ['WO-001', 'M-999', '领料', 3],
      ],
    });
    expect(wrong.result.status).toBe('NEEDS_REVIEW');
    expect(Number(wrong.result.metrics.wrongMaterialCount)).toBeGreaterThan(0);

    const missingActual = await runCase({
      bom: [
        ['产品编码', '物料编码', '单位耗用'],
        ['P-100', 'M-001', 2],
      ],
      output: [
        ['工单号', '产品编码', '合格产量'],
        ['WO-001', 'P-100', 10],
      ],
      issue: [
        ['工单号', '物料编码', '类型', '数量'],
        ['WO-001', 'M-002', '领料', 1],
      ],
      rules: { allowSubstituteMaterial: false },
    });
    expect(Number(missingActual.result.metrics.missingCount)).toBeGreaterThan(0);

    const missingBom = await runCase({
      bom: [
        ['产品编码', '物料编码', '单位耗用'],
        ['P-200', 'M-001', 1],
      ],
      output: [
        ['工单号', '产品编码', '合格产量'],
        ['WO-001', 'P-100', 10],
      ],
      issue: [
        ['工单号', '物料编码', '类型', '数量'],
        ['WO-001', 'M-001', '领料', 1],
      ],
    });
    expect(missingBom.result.status).toBe('NEEDS_REVIEW');
    expect(missingBom.result.exceptions.some((item) => item.code === 'MISSING_BOM')).toBe(true);
  });

  it('10-12: duplicate BOM, unit mismatch, aliases', async () => {
    const dup = await runCase({
      bom: [
        ['产品编码', '物料编码', '单位耗用', 'BOM版本'],
        ['P-100', 'M-001', 1, ''],
        ['P-100', 'M-001', 2, ''],
      ],
      output: [
        ['工单号', '产品编码', '合格产量'],
        ['WO-001', 'P-100', 10],
      ],
      issue: [
        ['工单号', '物料编码', '类型', '数量'],
        ['WO-001', 'M-001', '领料', 10],
      ],
    });
    expect(dup.result.exceptions.some((item) => item.code === 'DUPLICATE_BOM')).toBe(true);
    expect(dup.result.status).toBe('NEEDS_REVIEW');

    const unit = await runCase({
      bom: [
        ['产品编码', '物料编码', '单位耗用', '单位'],
        ['P-100', 'M-001', 1, 'KG'],
      ],
      output: [
        ['工单号', '产品编码', '合格产量'],
        ['WO-001', 'P-100', 10],
      ],
      issue: [
        ['工单号', '物料编码', '类型', '数量', '单位'],
        ['WO-001', 'M-001', '领料', 10, 'PCS'],
      ],
      rules: { overuseToleranceRate: 1, underuseToleranceRate: 1 },
    });
    expect(Number(unit.result.metrics.unitMismatchCount)).toBeGreaterThan(0);

    const alias = await runCase({
      bom: [
        ['成品编码', '子件编码', '定额', '损耗'],
        ['P-100', 'M-001', 2, 0],
      ],
      output: [
        ['生产订单', '成品编码', '良品数'],
        ['WO-001', 'P-100', 50],
      ],
      issue: [
        ['工单', '料号', '出入库类型', '数量'],
        ['WO-001', 'M-001', '出库', 100],
      ],
      rules: { overuseToleranceRate: 1, underuseToleranceRate: 1 },
    });
    const wb = XLSX.read(readFileSync(alias.result.outputFiles[0]!), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['工单耗用核对']!);
    nearly(Number(rows[0]!.standardQty), 100);
    nearly(Number(rows[0]!.actualQty), 100);
  });

  it('13-14: persisted rules reload and request.rules override', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-cc-rules-'));
    const base = {
      bom: [
        ['产品编码', '物料编码', '单位耗用'],
        ['P-100', 'M-001', 2],
      ] as unknown[][],
      output: [
        ['工单号', '产品编码', '合格产量'],
        ['WO-001', 'P-100', 100],
      ] as unknown[][],
      issue: [
        ['工单号', '物料编码', '类型', '数量'],
        ['WO-001', 'M-001', '领料', 200],
      ] as unknown[][],
    };

    const persistedRun = await runCase({
      ...base,
      rootDir: dir,
      companyId: 'demo-company',
      persisted: { defaultLossRate: 0.05, overuseToleranceRate: 1, underuseToleranceRate: 1 },
    });
    const wb = XLSX.read(readFileSync(persistedRun.result.outputFiles[0]!), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['工单耗用核对']!);
    nearly(Number(rows[0]!.standardQty), 210); // uses persisted 5%

    const overrideRun = await runCase({
      ...base,
      rootDir: dir,
      companyId: 'demo-company',
      rules: { defaultLossRate: 0, overuseToleranceRate: 1, underuseToleranceRate: 1 },
    });
    const wb2 = XLSX.read(readFileSync(overrideRun.result.outputFiles[0]!), { type: 'buffer' });
    const rows2 = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb2.Sheets['工单耗用核对']!);
    nearly(Number(rows2[0]!.standardQty), 200); // request.rules overrides persisted
  });

  it('19: deterministic repeated runs', async () => {
    const input = {
      bom: [
        ['产品编码', '物料编码', '单位耗用', '损耗率'],
        ['P-100', 'M-001', 2, 0.05],
      ] as unknown[][],
      output: [
        ['工单号', '产品编码', '合格产量'],
        ['WO-001', 'P-100', 100],
      ] as unknown[][],
      issue: [
        ['工单号', '物料编码', '类型', '数量'],
        ['WO-001', 'M-001', '领料', 220],
        ['WO-001', 'M-001', '退料', 5],
      ] as unknown[][],
      rules: { overuseToleranceRate: 0.1, underuseToleranceRate: 0.1 },
    };
    const a = await runCase(input);
    const b = await runCase(input);
    expect(a.result.metrics.standardQtyTotal).toBe(b.result.metrics.standardQtyTotal);
    expect(a.result.metrics.actualQtyTotal).toBe(b.result.metrics.actualQtyTotal);
    expect(a.result.metrics.outputRowCount).toBe(b.result.metrics.outputRowCount);
  });
});
