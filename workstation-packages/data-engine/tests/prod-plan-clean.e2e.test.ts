import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createWorkflowRuntime, roundQty } from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '数据');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

describe('PROD-PLAN-CLEAN-003 e2e', () => {
  it('28-32: 6 sheets, control totals, no fetch, desensitized AI', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-plan-e2e-'));
    const planPath = join(dir, '生产计划.xlsx');
    const stockPath = join(dir, '库存.xlsx');
    const capacityPath = join(dir, '产能.xlsx');
    const outputDir = join(dir, 'output');

    writeSheet(planPath, [
      ['计划号', '产品编码', '计划数量', '计划开始日期', '交期', '状态', '产线'],
      ['PLAN-001', 'P-100', 200, '2026-07-24', '2026-07-28', '已审核', 'LINE-01'],
    ]);
    writeSheet(stockPath, [
      ['产品编码', '可用库存', '预留库存'],
      ['P-100', 50, 10],
    ]);
    writeSheet(capacityPath, [
      ['产线', '日期', '可用工时', '每小时产量'],
      ['LINE-01', '2026-07-24', 8, 20],
    ]);

    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      throw new Error('network should not be used');
    }) as typeof fetch;

    try {
      const runtime = createWorkflowRuntime();
      const result = await runtime.execute({
        workflowId: 'PROD-PLAN-CLEAN-003',
        companyId: 'demo-company',
        inputFiles: [
          { role: 'production_plan', path: planPath },
          { role: 'finished_stock', path: stockPath },
          { role: 'capacity', path: capacityPath },
        ],
        outputDir,
        runDate: '2026-07-22',
      });

      expect(fetchCalls).toEqual([]);
      expect(result.errorMessage).toBeUndefined();
      expect(result.metrics.uploadedRawWorkbook).toBe(false);

      const outFile = join(outputDir, '可执行生产计划_2026-07-22.xlsx');
      expect(result.outputFiles[0]).toBe(outFile);
      expect(existsSync(outFile)).toBe(true);

      const workbook = XLSX.read(readFileSync(outFile), { type: 'buffer' });
      expect(workbook.SheetNames).toEqual([
        '可执行计划',
        '阻塞计划',
        '重复计划',
        '产能缺口',
        '库存覆盖',
        '运行说明',
      ]);

      const main = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets['可执行计划']!,
      );
      const row = main[0]!;
      expect(roundQty(Number(row.netAvailableQty))).toBe(40);
      expect(roundQty(Number(row.netRequiredQty))).toBe(160);
      expect(roundQty(Number(row.requiredHours))).toBe(8);
      expect(roundQty(Number(row.capacityGapHours))).toBe(0);
      expect(Number(row.daysToDue)).toBe(6);
      expect(row.resultStatus).toBe('READY');

      const notes = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets['运行说明']!,
      );
      const byKey = Object.fromEntries(notes.map((item) => [String(item.key), item.value]));
      expect(byKey.cloudUpload).toBe(false);
      expect(byKey['aiSummaryPayload.rawRows']).toBe(false);
      expect(Number(byKey.rawPlanQtyTotal)).toBe(200);
      expect(Number(byKey.selectedPlanQtyTotal)).toBe(200);
      expect(Number(byKey.executableNetRequiredQtyTotal)).toBe(160);
      expect(byKey.capacityChecked).toBe(true);

      const payloadText = JSON.stringify(result.aiSummaryPayload);
      expect(result.aiSummaryPayload?.rawRows).toBe(false);
      expect(payloadText).not.toContain('PLAN-001');
      expect(payloadText).not.toContain('P-100');
      expect(payloadText).not.toContain(planPath);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
