import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createWorkflowRuntime, roundQty } from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

async function runProgress(options: {
  plan: unknown[][];
  report: unknown[][];
  calendar?: unknown[][];
  rules?: Record<string, unknown>;
  runDate?: string;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-pg-'));
  const planPath = join(dir, 'plan.xlsx');
  const reportPath = join(dir, 'report.xlsx');
  writeSheet(planPath, options.plan);
  writeSheet(reportPath, options.report);
  const inputFiles = [
    { role: 'plan', path: planPath },
    { role: 'work_report', path: reportPath },
  ];
  if (options.calendar) {
    const calPath = join(dir, 'calendar.xlsx');
    writeSheet(calPath, options.calendar);
    inputFiles.push({ role: 'work_calendar', path: calPath });
  }
  const result = await createWorkflowRuntime().execute({
    workflowId: 'PROD-PROGRESS-004',
    inputFiles,
    rules: options.rules,
    outputDir: join(dir, 'out'),
    runDate: options.runDate ?? '2026-07-22',
  });
  const workbook = result.outputFiles[0]
    ? XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' })
    : null;
  return { result, workbook };
}

describe('PROD-PROGRESS-004', () => {
  it('normal progress, cumulative, rates, daily sheet', async () => {
    const { result, workbook } = await runProgress({
      plan: [
        ['工单号', '产品编码', '计划数量', '开始日期', '交期'],
        ['WO-001', 'P-100', 100, '2026-07-01', '2026-07-30'],
      ],
      report: [
        ['报工日期', '工单号', '合格产量', '报废数量', '工时'],
        ['2026-07-20', 'WO-001', 30, 1, 5],
        ['2026-07-21', 'WO-001', 20, 1, 4],
      ],
    });
    expect(result.errorMessage).toBeUndefined();
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook!.Sheets['工单进度']!,
    );
    const row = rows[0]!;
    expect(Number(row.cumulativeGoodQty)).toBe(50);
    expect(Number(row.cumulativeScrapQty)).toBe(2);
    expect(roundQty(Number(row.completionRate), 4)).toBe(0.5);
    expect(roundQty(Number(row.scrapRate), 4)).toBe(roundQty(2 / 52, 4));
    expect(workbook!.SheetNames).toEqual([
      '工单进度',
      '延期风险',
      '产量日报',
      '高报废工单',
      '数据异常',
      '运行说明',
    ]);
    const daily = XLSX.utils.sheet_to_json(workbook!.Sheets['产量日报']!);
    expect(daily.length).toBe(2);
  });

  it('plan without report / report without plan / conflict', async () => {
    const noReport = await runProgress({
      plan: [
        ['工单号', '产品编码', '计划数量', '开始日期', '交期'],
        ['WO-1', 'P-1', 10, '2026-07-01', '2026-07-30'],
      ],
      report: [
        ['报工日期', '工单号', '合格产量', '报废数量', '工时'],
        ['2026-07-20', 'WO-OTHER', 1, 0, 1],
      ],
    });
    expect(Number(noReport.result.metrics.anomalyCount)).toBeGreaterThan(0);

    const conflict = await runProgress({
      plan: [
        ['工单号', '产品编码', '计划数量', '开始日期', '交期'],
        ['WO-1', 'P-1', 10, '2026-07-01', '2026-07-30'],
        ['WO-1', 'P-1', 20, '2026-07-01', '2026-07-30'],
      ],
      report: [
        ['报工日期', '工单号', '合格产量', '报废数量', '工时'],
        ['2026-07-20', 'WO-1', 1, 0, 1],
      ],
    });
    expect(conflict.result.status).toBe('NEEDS_REVIEW');
  });

  it('overdue, high scrap, overproduction, calendar forecast', async () => {
    const overdue = await runProgress({
      plan: [
        ['工单号', '产品编码', '计划数量', '开始日期', '交期'],
        ['WO-1', 'P-1', 100, '2026-07-01', '2026-07-10'],
      ],
      report: [
        ['报工日期', '工单号', '合格产量', '报废数量', '工时'],
        ['2026-07-20', 'WO-1', 10, 0, 2],
      ],
    });
    const oRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      overdue.workbook!.Sheets['工单进度']!,
    );
    expect(oRows[0]!.primaryStatus).toBe('OVERDUE');

    const scrap = await runProgress({
      plan: [
        ['工单号', '产品编码', '计划数量', '开始日期', '交期'],
        ['WO-1', 'P-1', 100, '2026-07-01', '2026-08-30'],
      ],
      report: [
        ['报工日期', '工单号', '合格产量', '报废数量', '工时'],
        ['2026-07-20', 'WO-1', 10, 5, 2],
      ],
      rules: { maxScrapRate: 0.03 },
    });
    expect(Number(scrap.result.metrics.highScrapCount)).toBe(1);

    const over = await runProgress({
      plan: [
        ['工单号', '产品编码', '计划数量', '开始日期', '交期'],
        ['WO-1', 'P-1', 10, '2026-07-01', '2026-08-30'],
      ],
      report: [
        ['报工日期', '工单号', '合格产量', '报废数量', '工时'],
        ['2026-07-20', 'WO-1', 20, 0, 2],
      ],
      rules: { allowedOverproductionRate: 0.05 },
    });
    const overRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      over.workbook!.Sheets['工单进度']!,
    );
    expect(String(overRows[0]!.statusTags)).toContain('OVERPRODUCTION');

    const withCal = await runProgress({
      plan: [
        ['工单号', '产品编码', '计划数量', '开始日期', '交期'],
        ['WO-1', 'P-1', 100, '2026-07-01', '2026-08-30'],
      ],
      report: [
        ['报工日期', '工单号', '合格产量', '报废数量', '工时'],
        ['2026-07-20', 'WO-1', 20, 0, 4],
      ],
      calendar: [
        ['日期', '是否工作日', '可用工时'],
        ['2026-07-23', '是', 8],
        ['2026-07-24', '否', 0],
        ['2026-07-25', '是', 8],
        ['2026-07-26', '是', 8],
        ['2026-07-27', '是', 8],
        ['2026-07-28', '是', 8],
        ['2026-07-29', '是', 8],
        ['2026-07-30', '是', 8],
      ],
      rules: { useWorkCalendar: true, defaultWorkdayHours: 8 },
    });
    expect(withCal.result.metrics.calendarMode).toBe('WORKDAY');
    const notes = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      withCal.workbook!.Sheets['运行说明']!,
    );
    expect(notes.find((row) => row.key === 'calendarMode')?.value).toBe('WORKDAY');
  });

  it('e2e: no fetch, desensitized AI, deterministic', async () => {
    const input = {
      plan: [
        ['工单号', '产品编码', '计划数量', '开始日期', '交期'],
        ['WO-001', 'P-100', 100, '2026-07-01', '2026-07-30'],
      ] as unknown[][],
      report: [
        ['报工日期', '工单号', '合格产量', '报废数量', '工时'],
        ['2026-07-20', 'WO-001', 40, 0, 8],
      ] as unknown[][],
    };
    const fetchCalls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      fetchCalls.push(String(url));
      throw new Error('no network');
    }) as typeof fetch;
    try {
      const a = await runProgress(input);
      const b = await runProgress(input);
      expect(fetchCalls).toEqual([]);
      expect(a.result.metrics.uploadedRawWorkbook).toBe(false);
      expect(a.result.aiSummaryPayload?.rawRows).toBe(false);
      expect(JSON.stringify(a.result.aiSummaryPayload)).not.toContain('WO-001');
      expect(JSON.stringify(a.result.aiSummaryPayload)).not.toContain('P-100');
      expect(a.result.metrics.progressRowCount).toBe(b.result.metrics.progressRowCount);
      expect(existsSync(a.result.outputFiles[0]!)).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});
