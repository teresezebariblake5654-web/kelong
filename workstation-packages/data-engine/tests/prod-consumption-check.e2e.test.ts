import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createFileRuleStore, createWorkflowRuntime, roundQty } from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '数据');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

describe('PROD-CONSUMPTION-CHECK-002 e2e', () => {
  it('15-18: writes 7 sheets, no fetch, desensitized AI payload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-cc-e2e-'));
    const bomPath = join(dir, 'BOM.xlsx');
    const outputPath = join(dir, '产量.xlsx');
    const issuePath = join(dir, '领退料.xlsx');
    const outputDir = join(dir, 'output');

    writeSheet(bomPath, [
      ['产品编码', '物料编码', '物料名称', '单位耗用', '损耗率'],
      ['P-100', 'M-001', '钢板', 2, '5%'],
    ]);
    writeSheet(outputPath, [
      ['工单号', '产品编码', '合格产量'],
      ['WO-001', 'P-100', 100],
    ]);
    writeSheet(issuePath, [
      ['工单号', '物料编码', '类型', '数量'],
      ['WO-001', 'M-001', '领料', 220],
      ['WO-001', 'M-001', '退料', 5],
    ]);

    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      throw new Error('network should not be used');
    }) as typeof fetch;

    try {
      const persistedRuleStore = createFileRuleStore({ rootDir: dir });
      await persistedRuleStore.saveWorkflowRules('demo-company', 'PROD-CONSUMPTION-CHECK-002', {
        defaultLossRate: 0,
        overuseToleranceRate: 0.1,
        underuseToleranceRate: 0.1,
        allowSubstituteMaterial: false,
      });

      const runtime = createWorkflowRuntime({ persistedRuleStore });
      const result = await runtime.execute({
        workflowId: 'PROD-CONSUMPTION-CHECK-002',
        companyId: 'demo-company',
        // BOM loss 5% should win over persisted default 0
        inputFiles: [
          { role: 'bom', path: bomPath },
          { role: 'production_output', path: outputPath },
          { role: 'material_issue', path: issuePath },
        ],
        outputDir,
        runDate: '2026-07-22',
      });

      expect(fetchCalls).toEqual([]);
      expect(result.errorMessage).toBeUndefined();
      expect(result.metrics.uploadedRawWorkbook).toBe(false);

      const outputPathXlsx = join(outputDir, '物料消耗核对_2026-07-22.xlsx');
      expect(result.outputFiles[0]).toBe(outputPathXlsx);
      expect(existsSync(outputPathXlsx)).toBe(true);

      const workbook = XLSX.read(readFileSync(outputPathXlsx), { type: 'buffer' });
      expect(workbook.SheetNames).toEqual([
        '工单耗用核对',
        '超耗清单',
        '少耗清单',
        '错料清单',
        '缺失清单',
        '单位异常',
        '运行说明',
      ]);

      const main = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['工单耗用核对']!);
      const row = main[0]!;
      expect(roundQty(Number(row.standardQty))).toBe(210);
      expect(roundQty(Number(row.actualQty))).toBe(215);
      expect(roundQty(Number(row.varianceQty))).toBe(5);
      expect(roundQty(Number(row.varianceRate), 8)).toBe(roundQty(5 / 210, 8));
      expect(row.sourceTrace).toBeTruthy();
      expect(row.workflowVersion).toContain('PROD-CONSUMPTION-CHECK-002');
      expect(String(row.inputSha256).length).toBeGreaterThan(20);

      const notes = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['运行说明']!);
      const byKey = Object.fromEntries(notes.map((item) => [String(item.key), item.value]));
      expect(byKey.cloudUpload).toBe(false);
      expect(byKey['aiSummaryPayload.rawRows']).toBe(false);
      expect(byKey.workflowId).toBe('PROD-CONSUMPTION-CHECK-002');
      expect(String(byKey['input.bom.sha256'])).toMatch(/^[a-f0-9]{64}$/);

      const payloadText = JSON.stringify(result.aiSummaryPayload);
      expect(result.aiSummaryPayload?.rawRows).toBe(false);
      expect(payloadText).not.toContain('WO-001');
      expect(payloadText).not.toContain('M-001');
      expect(payloadText).not.toContain('P-100');
      expect(payloadText).not.toContain(bomPath);
      expect(payloadText).not.toContain('钢板');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
