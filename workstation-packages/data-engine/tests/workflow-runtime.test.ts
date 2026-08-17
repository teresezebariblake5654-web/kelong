import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  getWorkflowDefinition,
  listWorkflowDefinitions,
  WORKFLOW_CATALOG_ID,
} from '@aw/task-templates';
import {
  createWorkflowRuntime,
  executeWorkflow,
  joinRows,
  matchCanonicalField,
  createRuleStore,
  sha256Buffer,
} from '../src/index.js';

function sheetBuffer(rows: unknown[][], fileNameHint = 'sheet.xlsx') {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  void fileNameHint;
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('workflow catalog + runtime skeleton', () => {
  it('loads catalog and finds PROD-MATERIAL-DAILY-001', () => {
    expect(WORKFLOW_CATALOG_ID).toBe('agent-workstation-27-workflows');
    const definition = getWorkflowDefinition('PROD-MATERIAL-DAILY-001');
    expect(definition?.name).toBe('物料日清');
    expect(definition?.inputRoles.map((role) => role.role)).toEqual([
      'opening_stock',
      'movements',
      'physical_count',
    ]);
    expect(listWorkflowDefinitions({ deliveryWave: 1 }).length).toBeGreaterThan(0);
  });

  it('registers builtin operators and rule defaults', () => {
    const runtime = createWorkflowRuntime();
    expect(runtime.getOperatorRegistry().has('join')).toBe(true);
    expect(runtime.getOperatorRegistry().has('buildSourceTrace')).toBe(true);
    const rules = createRuleStore().resolve('PROD-MATERIAL-DAILY-001');
    expect(rules['materialDaily.toleranceQty']).toBe(1);
    expect(rules['materialDaily.toleranceRate']).toBe(0.05);
  });

  it('joins rows and matches field aliases', () => {
    const joined = joinRows({
      left: [{ materialCode: 'A', warehouse: 'W1', openingQty: 10 }],
      right: [{ materialCode: 'A', warehouse: 'W1', inQty: 2 }],
      keys: ['materialCode', 'warehouse'],
      joinType: 'full',
    });
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({ openingQty: 10, inQty: 2 });
    expect(matchCanonicalField('物料编码', { materialCode: ['物料编码', '料号', '编码'] })).toBe(
      'materialCode',
    );
  });
});

describe('PROD-MATERIAL-DAILY-001 unit', () => {
  it('computes theoretical closing and variance deterministically', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-md-unit-'));
    const openingPath = join(dir, 'opening.xlsx');
    const movementPath = join(dir, 'movements.xlsx');
    const countPath = join(dir, 'count.xlsx');
    const outputDir = join(dir, 'out');

    writeFileSync(
      openingPath,
      sheetBuffer([
        ['物料编码', '物料名称', '仓库', '期初数量', '单位'],
        ['M001', '螺丝', '原料仓', 100, 'PCS'],
        ['M002', '螺母', '原料仓', 50, 'PCS'],
      ]),
    );
    writeFileSync(
      movementPath,
      sheetBuffer([
        ['日期', '物料编码', '类型', '数量', '仓库', '单位'],
        ['2026-07-01', 'M001', '入库', 20, '原料仓', 'PCS'],
        ['2026-07-01', 'M001', '领料', 30, '原料仓', 'PCS'],
        ['2026-07-01', 'M001', '退料', 5, '原料仓', 'PCS'],
        ['2026-07-01', 'M002', '出库', 10, '原料仓', 'PCS'],
      ]),
    );
    writeFileSync(
      countPath,
      sheetBuffer([
        ['物料编码', '仓库', '实盘数量', '单位'],
        ['M001', '原料仓', 90, 'PCS'],
        ['M002', '原料仓', 40, 'PCS'],
      ]),
    );

    const request = {
      workflowId: 'PROD-MATERIAL-DAILY-001',
      inputFiles: [
        { role: 'opening_stock', path: openingPath },
        { role: 'movements', path: movementPath },
        { role: 'physical_count', path: countPath },
      ],
      companyRules: {
        'materialDaily.toleranceQty': 0.5,
        'materialDaily.toleranceRate': 0.01,
      },
      outputDir,
      runDate: '2026-07-22',
    };

    const first = await executeWorkflow(request);
    const second = await executeWorkflow(request);

    expect(first.status === 'COMPLETED' || first.status === 'NEEDS_REVIEW').toBe(true);
    expect(first.outputFiles).toHaveLength(1);
    expect(existsSync(first.outputFiles[0]!)).toBe(true);
    expect(first.metrics.uploadedRawWorkbook).toBe(false);
    expect(first.aiSummaryPayload?.rawRows).toBe(false);
    expect(JSON.stringify(first.aiSummaryPayload)).not.toContain('cleanedRows');

    const workbook = XLSX.read(readFileSync(first.outputFiles[0]!), { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(['日清总表', '库存差异', '负库存', '缺失数据', '运行说明']);
    const daily = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['日清总表']!);
    const m001 = daily.find((row) => row.materialCode === 'M001');
    expect(m001).toBeTruthy();
    // 100 + 20 - 30 + 5 = 95
    expect(Number(m001!.theoreticalClosingQty)).toBe(95);
    // actual 90 - 95 = -5
    expect(Number(m001!.varianceQty)).toBe(-5);
    expect(m001!.sourceFile).toBeTruthy();
    expect(m001!.sourceRow).toBeTruthy();
    expect(m001!.workflowVersion).toContain('PROD-MATERIAL-DAILY-001');
    expect(String(m001!.inputSha256).length).toBeGreaterThan(10);

    // Deterministic metrics for same inputs.
    expect(first.metrics.lineCount).toBe(second.metrics.lineCount);
    expect(first.metrics.varianceLineCount).toBe(second.metrics.varianceLineCount);

    const openingHash = sha256Buffer(readFileSync(openingPath));
    expect(openingHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('flags negative stock and missing physical count', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-md-neg-'));
    const openingPath = join(dir, 'opening.xlsx');
    const movementPath = join(dir, 'movements.xlsx');
    const countPath = join(dir, 'count.xlsx');
    const outputDir = join(dir, 'out');

    writeFileSync(
      openingPath,
      sheetBuffer([
        ['物料编码', '物料名称', '仓库', '期初数量'],
        ['N001', '负库存料', 'A仓', 5],
        ['N002', '缺盘料', 'A仓', 10],
      ]),
    );
    writeFileSync(
      movementPath,
      sheetBuffer([
        ['日期', '物料编码', '类型', '数量', '仓库'],
        ['2026-07-01', 'N001', '领料', 20, 'A仓'],
      ]),
    );
    writeFileSync(
      countPath,
      sheetBuffer([
        ['物料编码', '仓库', '实盘数量'],
        ['N001', 'A仓', 0],
      ]),
    );

    const result = await executeWorkflow({
      workflowId: 'PROD-MATERIAL-DAILY-001',
      inputFiles: [
        { role: 'opening_stock', path: openingPath },
        { role: 'movements', path: movementPath },
        { role: 'physical_count', path: countPath },
      ],
      outputDir,
      runDate: '2026-07-22',
    });

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.some((item) => item.code === 'negative_stock')).toBe(true);
    expect(result.exceptions.some((item) => item.code === 'missing_count')).toBe(true);
    expect(result.metrics.localExecution).toBe(true);
  });
});
