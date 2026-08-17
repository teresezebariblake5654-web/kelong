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

describe('production wave final e2e (004/005/006)', () => {
  it('generates three workbooks with required sheets and local-only markers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-prod6-'));
    const runtime = createWorkflowRuntime();
    const fetchCalls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      fetchCalls.push(String(url));
      throw new Error('no network');
    }) as typeof fetch;

    try {
      // PROGRESS
      const planPath = join(dir, 'plan.xlsx');
      const reportPath = join(dir, 'report.xlsx');
      writeSheet(planPath, [
        ['工单号', '产品编码', '计划数量', '开始日期', '交期'],
        ['WO-001', 'P-100', 100, '2026-07-01', '2026-07-30'],
      ]);
      writeSheet(reportPath, [
        ['报工日期', '工单号', '合格产量', '报废数量', '工时'],
        ['2026-07-20', 'WO-001', 40, 0, 8],
      ]);
      const progress = await runtime.execute({
        workflowId: 'PROD-PROGRESS-004',
        inputFiles: [
          { role: 'plan', path: planPath },
          { role: 'work_report', path: reportPath },
        ],
        outputDir: join(dir, 'progress-out'),
        runDate: '2026-07-22',
      });
      expect(existsSync(progress.outputFiles[0]!)).toBe(true);
      const progressWb = XLSX.read(readFileSync(progress.outputFiles[0]!), { type: 'buffer' });
      expect(progressWb.SheetNames).toHaveLength(6);
      const progressMain = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        progressWb.Sheets['工单进度']!,
      );
      expect(Number(progressMain[0]!.cumulativeGoodQty)).toBe(40);
      expect(roundQty(Number(progressMain[0]!.completionRate), 2)).toBe(0.4);

      // QUALITY
      const inspPath = join(dir, 'insp.xlsx');
      const stdPath = join(dir, 'std.xlsx');
      writeSheet(inspPath, [
        ['检验单号', '检验日期', '产品编码', '批次号', '工单号', '检验项目', '结果'],
        ['I-1', '2026-07-20', 'P-100', 'LOT-1', 'WO-001', '尺寸', 5],
      ]);
      writeSheet(stdPath, [
        ['产品编码', '检验项目', '结果类型', '下限', '上限'],
        ['P-100', '尺寸', 'NUMERIC', 1, 10],
      ]);
      const quality = await runtime.execute({
        workflowId: 'PROD-QUALITY-005',
        inputFiles: [
          { role: 'inspection', path: inspPath },
          { role: 'quality_standard', path: stdPath },
        ],
        outputDir: join(dir, 'quality-out'),
        runDate: '2026-07-22',
      });
      const qualityWb = XLSX.read(readFileSync(quality.outputFiles[0]!), { type: 'buffer' });
      expect(qualityWb.SheetNames).toHaveLength(7);
      const qualityMain = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        qualityWb.Sheets['质量总览']!,
      );
      expect(qualityMain[0]!.passFlag).toBe(true);

      // DOWNTIME
      const dtPath = join(dir, 'dt.xlsx');
      const woPath = join(dir, 'wo.xlsx');
      const wrPath = join(dir, 'wr.xlsx');
      const matPath = join(dir, 'mat.xlsx');
      const qPath = join(dir, 'q.xlsx');
      writeSheet(dtPath, [
        ['设备编号', '开始时间', '结束时间', '原因', '工单号', '标准小时产量'],
        ['M-1', '2026-07-22 08:00:00', '2026-07-22 09:00:00', '换模', 'WO-001', 30],
      ]);
      writeSheet(woPath, [
        ['工单号', '产品编码', '计划数量', '状态'],
        ['WO-001', 'P-100', 10, 'RELEASED'],
      ]);
      writeSheet(wrPath, [
        ['工单号', '报工日期', '合格产量', '报废数量', '工时'],
        ['WO-001', '2026-07-21', 10, 0, 1],
      ]);
      writeSheet(matPath, [
        ['工单号', '标准数量', '实际数量', '差异率', '未解决问题数'],
        ['WO-001', 10, 10, 0, 0],
      ]);
      writeSheet(qPath, [
        ['工单号', '未关闭问题数', '致命未关闭'],
        ['WO-001', 0, 0],
      ]);
      const downtime = await runtime.execute({
        workflowId: 'PROD-DOWNTIME-CLOSE-006',
        inputFiles: [
          { role: 'downtime', path: dtPath },
          { role: 'work_order', path: woPath },
          { role: 'work_report', path: wrPath },
          { role: 'material_summary', path: matPath },
          { role: 'quality_open_items', path: qPath },
        ],
        rules: {
          timezone: 'UTC',
          requireMaterialBalanced: true,
          requireNoOpenQualityIssue: true,
          requireNoCriticalQualityIssue: true,
        },
        outputDir: join(dir, 'downtime-out'),
        runDate: '2026-07-22',
      });
      const downtimeWb = XLSX.read(readFileSync(downtime.outputFiles[0]!), { type: 'buffer' });
      expect(downtimeWb.SheetNames).toHaveLength(6);
      expect(Number(downtime.metrics.netDowntimeMinutesTotal)).toBe(60);
      expect(Number(downtime.metrics.closableCount)).toBe(1);

      for (const result of [progress, quality, downtime]) {
        const notes = XLSX.utils.sheet_to_json<Record<string, unknown>>(
          XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' }).Sheets['运行说明']!,
        );
        const byKey = Object.fromEntries(notes.map((row) => [String(row.key), row.value]));
        expect(byKey.cloudUpload).toBe(false);
        expect(byKey['aiSummaryPayload.rawRows']).toBe(false);
        expect(result.metrics.uploadedRawWorkbook).toBe(false);
        expect(result.aiSummaryPayload?.rawRows).toBe(false);
        expect(String(result.workflowVersion)).toContain(result.workflowId);
      }

      expect(fetchCalls).toEqual([]);

      // Expose paths for report consumers via metrics-like console is unnecessary;
      // assert path suffixes.
      expect(progress.outputFiles[0]).toContain('生产进度产量_2026-07-22.xlsx');
      expect(quality.outputFiles[0]).toContain('质量异常处理_2026-07-22.xlsx');
      expect(downtime.outputFiles[0]).toContain('停机损失与工单结案_2026-07-22.xlsx');
    } finally {
      globalThis.fetch = original;
    }
  });
});
