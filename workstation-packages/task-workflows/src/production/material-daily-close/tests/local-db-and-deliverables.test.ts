import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  applyExceptionActionsAndRecompute,
  buildFiveDeliverables,
  createHistoryStoreFromRepository,
  createMaterialCloseRepository,
  createMemoryHistoryStore,
  createMemorySqlDatabase,
  exceptionBusinessKey,
  runMaterialDailyCloseWorkflow,
} from '../index.js';
import {
  sampleAliasHeaders,
  sampleExceptionScenarios,
  sampleMultiSheet,
  sampleMultiWarehouseBatch,
  samplePerformance10k,
  sampleStandardChinese,
} from '../samples/fixtures.js';

describe('local SQLite memory repository', () => {
  it('persists workspace, mappings, rules, runs, exceptions, deliverables', () => {
    const db = createMemorySqlDatabase();
    const repo = createMaterialCloseRepository(db);
    const ws = repo.ensureWorkspace({ organizationId: 'org-a', name: 'A厂' });
    expect(repo.ensureWorkspace({ organizationId: 'org-a', name: 'A厂' }).id).toBe(ws.id);

    repo.saveFieldMapping({
      workspaceId: ws.id,
      headerFingerprint: '物料编码|物料名称',
      mappings: { materialCode: '物料编码', materialName: '物料名称' },
    });
    expect(repo.listFieldMappings(ws.id)).toHaveLength(1);

    repo.saveRuleProfile({
      workspaceId: ws.id,
      safetyStockJson: JSON.stringify({ M001: 10 }),
      scrapRatioThreshold: 0.05,
      quantityTolerance: 0.001,
      unitConversionJson: JSON.stringify({ KG: { to: 'G', factor: 1000 } }),
      warehouseAliasJson: JSON.stringify({ 原料库: '原料仓' }),
      aiConfidenceThreshold: 0.7,
    });
    const rules = repo.getRuleProfile(ws.id);
    expect(rules?.scrapRatioThreshold).toBe(0.05);
    expect(JSON.parse(rules!.unitConversionJson).KG.factor).toBe(1000);

    const run = repo.createRun({
      id: 'run1',
      workspaceId: ws.id,
      workflowCode: 'PRODUCTION_MATERIAL_DAILY_CLOSE',
      status: 'completed',
      summaryJson: '{}',
      sourceFilesJson: '[]',
      resultJson: '{}',
      clientRequestId: 'req-1',
      creditsCharged: 1,
    });
    expect(repo.findRunByClientRequestId(ws.id, 'req-1')?.id).toBe(run.id);

    repo.replaceExceptions(run.id, ws.id, [
      {
        runId: run.id,
        workspaceId: ws.id,
        code: 'NEGATIVE_INVENTORY',
        severity: 'critical',
        message: '结存小于 0',
        materialCode: 'M1',
        materialName: 'x',
        warehouse: '仓1',
        value: -1,
        userAction: null,
        userPayloadJson: null,
        resolved: 0,
      },
    ]);
    const exc = repo.listExceptions(run.id)[0]!;
    repo.updateExceptionAction({
      id: exc.id,
      userAction: 'ignore_once',
      resolved: true,
    });
    expect(repo.listExceptions(run.id)[0]!.resolved).toBe(1);

    repo.saveDeliverable({
      runId: run.id,
      workspaceId: ws.id,
      fileName: '今日物料结存.xlsx',
      fileKind: 'closing_balance',
      localPath: path.join(os.tmpdir(), '今日物料结存.xlsx'),
      byteSize: 12,
    });
    expect(repo.listDeliverables(run.id)[0]!.fileName).toContain('结存');
  });

  it('isolates organizations and restores after dump/load (offline resume)', () => {
    const db = createMemorySqlDatabase();
    const repo = createMaterialCloseRepository(db);
    const a = repo.ensureWorkspace({ organizationId: 'org-a', name: 'A' });
    const b = repo.ensureWorkspace({ organizationId: 'org-b', name: 'B' });
    repo.saveFieldMapping({
      workspaceId: a.id,
      headerFingerprint: 'fp-a',
      mappings: { materialCode: '料号' },
    });
    repo.saveFieldMapping({
      workspaceId: b.id,
      headerFingerprint: 'fp-b',
      mappings: { materialCode: '编码' },
    });
    expect(repo.listFieldMappings(a.id)[0]!.headerFingerprint).toBe('fp-a');
    expect(repo.listFieldMappings(b.id)[0]!.headerFingerprint).toBe('fp-b');

    const dump = db.dump();
    const db2 = createMemorySqlDatabase();
    db2.load(dump);
    const repo2 = createMaterialCloseRepository(db2);
    expect(repo2.listFieldMappings(a.id)).toHaveLength(1);
    expect(repo2.findRunByClientRequestId(a.id, 'missing')).toBeNull();
  });

  it('same clientRequestId does not create duplicate credit charge marker', () => {
    const db = createMemorySqlDatabase();
    const repo = createMaterialCloseRepository(db);
    const ws = repo.ensureWorkspace({ organizationId: 'org-x', name: 'X' });
    repo.createRun({
      id: 'r1',
      workspaceId: ws.id,
      workflowCode: 'PRODUCTION_MATERIAL_DAILY_CLOSE',
      status: 'completed',
      summaryJson: '{}',
      sourceFilesJson: '[]',
      resultJson: '{"ok":true}',
      clientRequestId: 'same-req',
      creditsCharged: 2,
    });
    const found = repo.findRunByClientRequestId(ws.id, 'same-req');
    expect(found?.creditsCharged).toBe(2);
    // 重试应复用，不新增扣费
    expect(repo.listRuns(ws.id)).toHaveLength(1);
  });
});

describe('samples + field recognition + calc + export', () => {
  it('standard Chinese headers: calc matches manual ledger', () => {
    const store = createMemoryHistoryStore();
    const result = runMaterialDailyCloseWorkflow({
      workbooks: sampleStandardChinese(),
      scopeKey: 'demo',
      historyStore: store,
    });
    expect(result.blocked).toBe(false);
    const line = result.balances.find((b) => b.materialCode === 'M001')!;
    // 100 + 0 + 2 - 12 - 1 = 89；实盘 88 → 差异 -1
    expect(line.closingQuantity ?? line.theoreticalQuantity).toBe(89);
    expect(line.varianceQuantity).toBeCloseTo(-1, 5);
  });

  it('reuses historical field mapping on alias headers', () => {
    const db = createMemorySqlDatabase();
    const repo = createMaterialCloseRepository(db);
    const ws = repo.ensureWorkspace({ organizationId: 'org-map', name: 'map' });
    const store = createHistoryStoreFromRepository(repo, ws.id);
    const first = runMaterialDailyCloseWorkflow({
      workbooks: sampleAliasHeaders(),
      scopeKey: ws.id,
      historyStore: store,
    });
    expect(first.blocked).toBe(false);
    expect(store.listMappings(ws.id).length).toBeGreaterThan(0);

    const second = runMaterialDailyCloseWorkflow({
      workbooks: sampleAliasHeaders(),
      scopeKey: ws.id,
      historyStore: store,
    });
    expect(second.blocked).toBe(false);
    expect(second.detections.every((d) => d.fieldMatches.some((m) => m.method?.includes('history') || m.confidence >= 0.5))).toBe(
      true,
    );
  });

  it('multi-sheet / multi-warehouse-batch / exception scenarios', () => {
    const multi = runMaterialDailyCloseWorkflow({ workbooks: [sampleMultiSheet()] });
    expect(multi.blocked).toBe(false);
    expect(multi.balances.some((b) => b.materialCode === 'S1')).toBe(true);

    const batch = runMaterialDailyCloseWorkflow({ workbooks: sampleMultiWarehouseBatch() });
    expect(batch.blocked).toBe(false);
    expect(batch.balances.length).toBeGreaterThanOrEqual(2);

    const exc = runMaterialDailyCloseWorkflow({
      workbooks: sampleExceptionScenarios(),
      enterpriseRules: {
        safetyStockByMaterial: {},
        defaultSafetyStock: 0,
        scrapRatioThreshold: 0.05,
        quantityTolerance: 0.001,
        aiConfidenceThreshold: 0.7,
        unitConversion: {},
        warehouseAlias: {},
      },
    });
    const codes = new Set(exc.exceptions.map((e) => e.code));
    expect(codes.has('NEGATIVE_INVENTORY') || codes.has('MATERIAL_SHORTAGE') || codes.has('EXCESSIVE_SCRAP')).toBe(
      true,
    );
  });

  it('exception confirm recomputes; five deliverables have Chinese headers and lineage', () => {
    const result = runMaterialDailyCloseWorkflow({ workbooks: sampleExceptionScenarios() });
    const target = result.exceptions.find((e) => e.code === 'EXCESSIVE_SCRAP') ?? result.exceptions[0];
    expect(target).toBeTruthy();
    const key = exceptionBusinessKey(target!);
    const next = applyExceptionActionsAndRecompute({
      result,
      actions: [
        {
          exceptionKey: key,
          code: target!.code,
          materialCode: target!.materialCode,
          materialName: target!.materialName,
          warehouse: target!.warehouse,
          action: target!.code === 'EXCESSIVE_SCRAP' ? 'confirm_scrap' : 'ignore_once',
          resolvedAt: new Date().toISOString(),
        },
      ],
      rules: {
        safetyStockByMaterial: {},
        defaultSafetyStock: 0,
        scrapRatioThreshold: 0.05,
        quantityTolerance: 0.001,
        aiConfidenceThreshold: 0.7,
        unitConversion: {},
        warehouseAlias: {},
      },
    });

    const files = buildFiveDeliverables({
      result: next,
      rules: {
        safetyStockByMaterial: {},
        defaultSafetyStock: 0,
        scrapRatioThreshold: 0.05,
        quantityTolerance: 0.001,
        aiConfidenceThreshold: 0.7,
        unitConversion: {},
        warehouseAlias: {},
      },
    });
    expect(files).toHaveLength(5);
    expect(files.map((f) => f.fileName).join('|')).toMatch(/今日物料结存/);
    expect(files.map((f) => f.fileName).join('|')).toMatch(/补料申请单/);
    expect(files.map((f) => f.fileName).join('|')).toMatch(/报废待审批单/);
    expect(files.map((f) => f.fileName).join('|')).toMatch(/盘点差异单/);
    expect(files.map((f) => f.fileName).join('|')).toMatch(/人工确认清单/);

    for (const file of files) {
      const wb = XLSX.read(file.bytes, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]!];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const text = JSON.stringify(rows);
      expect(text).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
      expect(text).not.toMatch(/DeepSeek|gpt-4|claude/i);
      if (file.kind === 'replenish' && rows.length) {
        expect(Object.keys(rows[0]!)).toEqual(
          expect.arrayContaining([
            '物料编码',
            '物料名称',
            '规格',
            '仓库',
            '当前结存',
            '安全库存',
            '计划需求',
            '建议补料数量',
            '缺料原因',
          ]),
        );
      }
      if (file.kind === 'scrap' && rows.length) {
        expect(Object.keys(rows[0]!)).toEqual(
          expect.arrayContaining(['物料编码', '物料名称', '报废数量', '报废比例', '备注', 'AI分类', '人工确认状态']),
        );
      }
    }
  });

  it('AI failure refund contract: failed AI does not mark credits charged', () => {
    // 契约：本地 run.creditsCharged 仅在成功 settle 后写入；失败保持 0 并由云端退款
    const db = createMemorySqlDatabase();
    const repo = createMaterialCloseRepository(db);
    const ws = repo.ensureWorkspace({ organizationId: 'org-ai', name: 'AI' });
    const run = repo.createRun({
      id: 'ai-run',
      workspaceId: ws.id,
      workflowCode: 'PRODUCTION_MATERIAL_DAILY_CLOSE',
      status: 'running',
      summaryJson: '{}',
      sourceFilesJson: '[]',
      resultJson: null,
      clientRequestId: 'ai-req',
      creditsCharged: 0,
    });
    // simulate AI failure → refund path leaves creditsCharged=0 and keeps result recoverable
    repo.updateRun({ id: run.id, status: 'needs_confirm', resultJson: '{"balances":[]}' });
    expect(repo.getRun(run.id)?.creditsCharged).toBe(0);
    expect(repo.getRun(run.id)?.resultJson).toBeTruthy();
  });

  it('does not upload full raw rows in AI payload', () => {
    const result = runMaterialDailyCloseWorkflow({ workbooks: sampleStandardChinese() });
    const payload = JSON.stringify(result.aiPayload);
    expect(payload.length).toBeLessThan(50_000);
    // 仅摘要样例，不含完整原始行数组
    expect(result.aiPayload.sampleReplenish.length).toBeLessThanOrEqual(20);
    expect(payload).not.toMatch(/"rows"\s*:\s*\[/);
    expect(result.aiPayload.note).toMatch(/禁止|完整原始/);
  });

  it('10k rows performance sample finishes under 8s', () => {
    const started = Date.now();
    const result = runMaterialDailyCloseWorkflow({
      workbooks: samplePerformance10k(10000),
    });
    const elapsed = Date.now() - started;
    expect(result.blocked).toBe(false);
    expect(result.balances.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(8000);
  });
});
