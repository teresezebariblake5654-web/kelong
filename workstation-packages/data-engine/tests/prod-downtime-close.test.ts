import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  calculateIntervalDurationMinutes,
  createWorkflowRuntime,
  detectIntervalOverlap,
  mergeIntervals,
  normalizeDateTime,
  roundQty,
  totalIntervalMinutes,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

async function runClose(options: {
  downtime: unknown[][];
  workOrder: unknown[][];
  report: unknown[][];
  material?: unknown[][];
  quality?: unknown[][];
  rules?: Record<string, unknown>;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-dt-'));
  const downtimePath = join(dir, 'downtime.xlsx');
  const woPath = join(dir, 'wo.xlsx');
  const reportPath = join(dir, 'report.xlsx');
  writeSheet(downtimePath, options.downtime);
  writeSheet(woPath, options.workOrder);
  writeSheet(reportPath, options.report);
  const inputFiles = [
    { role: 'downtime', path: downtimePath },
    { role: 'work_order', path: woPath },
    { role: 'work_report', path: reportPath },
  ];
  if (options.material) {
    const path = join(dir, 'material.xlsx');
    writeSheet(path, options.material);
    inputFiles.push({ role: 'material_summary', path });
  }
  if (options.quality) {
    const path = join(dir, 'quality.xlsx');
    writeSheet(path, options.quality);
    inputFiles.push({ role: 'quality_open_items', path });
  }
  const result = await createWorkflowRuntime().execute({
    workflowId: 'PROD-DOWNTIME-CLOSE-006',
    inputFiles,
    rules: { timezone: 'UTC', ...options.rules },
    outputDir: join(dir, 'out'),
    runDate: '2026-07-22',
  });
  const workbook = result.outputFiles[0]
    ? XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' })
    : null;
  return { result, workbook };
}

describe('datetime/interval operators', () => {
  it('normalizes datetime and merges overlaps', () => {
    const start = normalizeDateTime('2026-07-22 22:00:00', { timezone: 'UTC' });
    const end = normalizeDateTime('2026-07-23 02:00:00', { timezone: 'UTC' });
    expect(start.ok && end.ok).toBe(true);
    if (start.ok && end.ok) {
      expect(calculateIntervalDurationMinutes(start.iso, end.iso)).toBe(240);
    }
    const overlaps = detectIntervalOverlap([
      { startMs: 0, endMs: 100 * 60_000 },
      { startMs: 50 * 60_000, endMs: 150 * 60_000 },
    ]);
    expect(overlaps).toHaveLength(1);
    const merged = mergeIntervals([
      { startMs: 0, endMs: 100 * 60_000 },
      { startMs: 50 * 60_000, endMs: 150 * 60_000 },
    ]);
    expect(totalIntervalMinutes(merged)).toBe(150);
  });
});

describe('PROD-DOWNTIME-CLOSE-006', () => {
  it('computes downtime, closable and blocked decisions', async () => {
    const { result, workbook } = await runClose({
      downtime: [
        ['设备编号', '开始时间', '结束时间', '原因', '工单号', '计划停机', '标准小时产量'],
        ['M-1', '2026-07-22 08:00:00', '2026-07-22 10:00:00', '换模', 'WO-1', '是', 60],
        ['M-1', '2026-07-22 09:00:00', '2026-07-22 11:00:00', '故障', 'WO-1', '否', 60],
      ],
      workOrder: [
        ['工单号', '产品编码', '计划数量', '状态'],
        ['WO-1', 'P-1', 100, 'RELEASED'],
        ['WO-2', 'P-2', 50, 'RELEASED'],
      ],
      report: [
        ['工单号', '报工日期', '合格产量', '报废数量', '工时'],
        ['WO-1', '2026-07-21', 98, 2, 10],
        ['WO-2', '2026-07-21', 10, 0, 2],
      ],
      material: [
        ['工单号', '标准数量', '实际数量', '差异率', '未解决问题数'],
        ['WO-1', 100, 100, 0, 0],
        ['WO-2', 50, 80, 0.6, 1],
      ],
      quality: [
        ['工单号', '未关闭问题数', '致命未关闭'],
        ['WO-1', 0, 0],
        ['WO-2', 2, 1],
      ],
      rules: {
        overlapStrategy: 'MERGE_FOR_NET_DURATION',
        defaultUnitsPerHour: 60,
        outputToleranceRate: 0.02,
        requireMaterialBalanced: true,
        requireNoOpenQualityIssue: true,
        requireNoCriticalQualityIssue: true,
      },
    });

    expect(result.errorMessage).toBeUndefined();
    expect(workbook!.SheetNames).toEqual([
      '停机损失',
      '停机原因分析',
      '可结案工单',
      '阻塞工单',
      '重叠与数据异常',
      '运行说明',
    ]);
    expect(Number(result.metrics.closableCount)).toBeGreaterThanOrEqual(1);
    expect(Number(result.metrics.blockedCount)).toBeGreaterThanOrEqual(1);
    expect(result.aiSummaryPayload?.rawRows).toBe(false);
    expect(JSON.stringify(result.aiSummaryPayload)).not.toContain('WO-1');
    expect(JSON.stringify(result.aiSummaryPayload)).not.toContain('M-1');
    expect(result.metrics.uploadedRawWorkbook).toBe(false);

    const loss = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['停机损失']!);
    expect(loss.length).toBe(2);
    // merged net for machine = 3 hours = 180 minutes
    expect(roundQty(Number(result.metrics.netDowntimeMinutesTotal), 2)).toBe(180);
  });

  it('blocks when material data missing and invalid interval', async () => {
    const missing = await runClose({
      downtime: [
        ['设备编号', '开始时间', '结束时间', '原因', '工单号'],
        ['M-1', '2026-07-22 08:00:00', '2026-07-22 09:00:00', '故障', 'WO-1'],
      ],
      workOrder: [
        ['工单号', '产品编码', '计划数量', '状态'],
        ['WO-1', 'P-1', 10, 'RELEASED'],
      ],
      report: [
        ['工单号', '报工日期', '合格产量', '报废数量', '工时'],
        ['WO-1', '2026-07-21', 10, 0, 1],
      ],
      rules: {
        requireMaterialBalanced: true,
        requireNoOpenQualityIssue: false,
        requireNoCriticalQualityIssue: false,
        defaultUnitsPerHour: 10,
      },
    });
    expect(missing.result.status).toBe('NEEDS_REVIEW');
    expect(
      missing.result.exceptions.some((item) => item.code === 'MATERIAL_DATA_MISSING'),
    ).toBe(true);

    const invalid = await runClose({
      downtime: [
        ['设备编号', '开始时间', '结束时间', '原因'],
        ['M-1', '2026-07-22 10:00:00', '2026-07-22 09:00:00', '故障'],
      ],
      workOrder: [
        ['工单号', '产品编码', '计划数量', '状态'],
        ['WO-1', 'P-1', 10, 'RELEASED'],
      ],
      report: [
        ['工单号', '报工日期', '合格产量', '报废数量', '工时'],
        ['WO-1', '2026-07-21', 10, 0, 1],
      ],
      material: [
        ['工单号', '标准数量', '实际数量', '差异率', '未解决问题数'],
        ['WO-1', 10, 10, 0, 0],
      ],
      quality: [
        ['工单号', '未关闭问题数', '致命未关闭'],
        ['WO-1', 0, 0],
      ],
      rules: {
        requireMaterialBalanced: true,
        requireNoOpenQualityIssue: true,
        requireNoCriticalQualityIssue: true,
      },
    });
    expect(
      invalid.result.exceptions.some((item) => item.code === 'INVALID_DOWNTIME_INTERVAL'),
    ).toBe(true);
  });

  it('deterministic and no fetch', async () => {
    const input = {
      downtime: [
        ['设备编号', '开始时间', '结束时间', '原因', '工单号', '标准小时产量'],
        ['M-1', '2026-07-22 08:00:00', '2026-07-22 09:00:00', '换模', 'WO-1', 30],
      ] as unknown[][],
      workOrder: [
        ['工单号', '产品编码', '计划数量', '状态'],
        ['WO-1', 'P-1', 10, 'RELEASED'],
      ] as unknown[][],
      report: [
        ['工单号', '报工日期', '合格产量', '报废数量', '工时'],
        ['WO-1', '2026-07-21', 10, 0, 1],
      ] as unknown[][],
      material: [
        ['工单号', '标准数量', '实际数量', '差异率', '未解决问题数'],
        ['WO-1', 10, 10, 0, 0],
      ] as unknown[][],
      quality: [
        ['工单号', '未关闭问题数', '致命未关闭'],
        ['WO-1', 0, 0],
      ] as unknown[][],
      rules: {
        requireMaterialBalanced: true,
        requireNoOpenQualityIssue: true,
        requireNoCriticalQualityIssue: true,
      },
    };
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      throw new Error('no network');
    }) as typeof fetch;
    try {
      const a = await runClose(input);
      const b = await runClose(input);
      expect(calls).toEqual([]);
      expect(a.result.metrics.netDowntimeMinutesTotal).toBe(b.result.metrics.netDowntimeMinutesTotal);
      expect(a.result.metrics.closableCount).toBe(b.result.metrics.closableCount);
    } finally {
      globalThis.fetch = original;
    }
  });
});
