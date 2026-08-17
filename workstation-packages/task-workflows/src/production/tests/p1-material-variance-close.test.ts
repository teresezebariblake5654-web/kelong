import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  WorkspaceDatabaseManager,
  buildProductionDeliverables,
  createProductionRepository,
  recomputeWithActions,
  runProductionWorkflow,
} from '../../index.js';

describe('Phase P1 material_variance_close', () => {
  it('computes theoretical/actual/variance and exports five files', () => {
    WorkspaceDatabaseManager._resetForTests();
    WorkspaceDatabaseManager.initRoundDatabases();
    const repo = createProductionRepository();
    const ws = repo.ensureWorkspace('org-p1');

    const result = runProductionWorkflow('material_variance_close', {
      workbooks: [
        {
          fileName: 'BOM标准用量.xlsx',
          sheets: [
            {
              sheetName: 'BOM',
              headers: ['物料编码', '物料名称', '产品编码', '标准用量'],
              rows: [
                { 物料编码: 'M1', 物料名称: '树脂', 产品编码: 'P1', 标准用量: 2 },
                { 物料编码: 'M2', 物料名称: '固化剂', 产品编码: 'P1', 标准用量: 0.5 },
              ],
            },
          ],
        },
        {
          fileName: '实际产量.xlsx',
          sheets: [
            {
              sheetName: '产量',
              headers: ['产品编码', '产品名称', '合格产量'],
              rows: [{ 产品编码: 'P1', 产品名称: '成品A', 合格产量: 10 }],
            },
          ],
        },
        {
          fileName: '领料.xlsx',
          sheets: [
            {
              sheetName: '领料',
              headers: ['物料编码', '物料名称', '领料数量'],
              rows: [
                { 物料编码: 'M1', 物料名称: '树脂', 领料数量: 25 },
                { 物料编码: 'M2', 物料名称: '固化剂', 领料数量: 5 },
              ],
            },
          ],
        },
        {
          fileName: '退料.xlsx',
          sheets: [
            {
              sheetName: '退料',
              headers: ['物料编码', '物料名称', '退料数量'],
              rows: [{ 物料编码: 'M1', 物料名称: '树脂', 退料数量: 1 }],
            },
          ],
        },
      ],
      organizationId: 'org-p1',
    });

    expect(result.blocked).toBe(false);
    // 理论 M1=20, 实际=24, 差异=4
    const m1 = (result.tables.variance ?? []).find((r) => r['物料编码'] === 'M1')!;
    expect(m1['理论消耗']).toBe(20);
    expect(m1['实际消耗']).toBe(24);
    expect(m1['消耗差异']).toBe(4);

    const files = buildProductionDeliverables('material_variance_close', result);
    expect(files).toHaveLength(5);
    expect(files.map((f) => f.fileName).join('|')).toMatch(/物料消耗差异|超耗核实单|异常领料单|待退料清单|人工确认清单/);

    for (const file of files) {
      const wb = XLSX.read(file.bytes, { type: 'array' });
      expect(wb.SheetNames.length).toBeGreaterThan(0);
    }

    repo.createRun({
      id: 'run-p1',
      workspaceId: ws.id,
      taskCode: 'material_variance_close',
      status: 'completed',
      summaryJson: JSON.stringify(result.summary),
      sourceFilesJson: '[]',
      resultJson: JSON.stringify({ summary: result.summary }),
      clientRequestId: 'p1-req',
      creditsCharged: 0,
    });
    repo.saveFieldMapping({
      workspaceId: ws.id,
      taskCode: 'material_variance_close',
      headerFingerprint: '物料编码|标准用量',
      mappings: { materialCode: '物料编码', standardUsage: '标准用量' },
    });
    expect(repo.listFieldMappings(ws.id, 'material_variance_close')).toHaveLength(1);
    expect(repo.findRunByClientRequestId(ws.id, 'p1-req')?.creditsCharged).toBe(0);

    // 任意路径不被接受：只允许白名单工作区 id（禁止任意 DB 路径）
    expect(() => WorkspaceDatabaseManager.open('evil' as 'production')).toThrow(/禁止打开/);
    // 生产模块入口只能拿到 production
    expect(WorkspaceDatabaseManager.relativePath('production')).toBe('data/production/production.db');
    expect(WorkspaceDatabaseManager.relativePath('app')).toBe('data/system/app.db');

    const next = recomputeWithActions(
      'material_variance_close',
      result,
      [
        {
          exceptionKey: 'x',
          code: 'EXCESS_CONSUMPTION',
          action: 'ignore_once',
          materialCode: 'M1',
          resolvedAt: new Date().toISOString(),
        },
      ],
      [
        {
          fileName: 'BOM标准用量.xlsx',
          sheets: [
            {
              sheetName: 'BOM',
              headers: ['物料编码', '物料名称', '产品编码', '标准用量'],
              rows: [{ 物料编码: 'M1', 物料名称: '树脂', 产品编码: 'P1', 标准用量: 2 }],
            },
          ],
        },
        {
          fileName: '实际产量.xlsx',
          sheets: [
            {
              sheetName: '产量',
              headers: ['产品编码', '合格产量'],
              rows: [{ 产品编码: 'P1', 合格产量: 10 }],
            },
          ],
        },
        {
          fileName: '领料.xlsx',
          sheets: [
            {
              sheetName: '领料',
              headers: ['物料编码', '领料数量'],
              rows: [{ 物料编码: 'M1', 领料数量: 25 }],
            },
          ],
        },
      ],
    );
    expect(next.exceptions.every((e) => e.materialCode !== 'M1' || e.code !== 'EXCESS_CONSUMPTION')).toBe(true);
  });
});
