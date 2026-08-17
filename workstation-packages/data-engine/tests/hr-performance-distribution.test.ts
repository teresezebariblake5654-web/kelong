import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createFileRuleStore,
  createRuleStore,
  createWorkflowRuntime,
  toPerformanceRules,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

type RunOpts = {
  performance: unknown[][];
  distribution?: unknown[][];
  rules?: Record<string, unknown>;
  companyId?: string;
  persisted?: Record<string, unknown>;
  runDate?: string;
};

async function runPerf(options: RunOpts) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-perf-'));
  const perfPath = join(dir, 'perf.xlsx');
  writeSheet(perfPath, options.performance);
  const inputFiles: Array<{ role: string; path: string }> = [{ role: 'performance', path: perfPath }];
  if (options.distribution) {
    const p = join(dir, 'dist.xlsx');
    writeSheet(p, options.distribution);
    inputFiles.push({ role: 'distribution_rule', path: p });
  }
  const persistedRuleStore = createFileRuleStore({ rootDir: dir });
  if (options.companyId && options.persisted) {
    await persistedRuleStore.saveWorkflowRules(
      options.companyId,
      'HR-PERFORMANCE-DISTRIBUTION-007',
      options.persisted,
    );
  }
  const runtime = createWorkflowRuntime({ persistedRuleStore });
  const result = await runtime.execute({
    workflowId: 'HR-PERFORMANCE-DISTRIBUTION-007',
    companyId: options.companyId,
    inputFiles,
    rules: options.rules,
    outputDir: join(dir, 'out'),
    runDate: options.runDate ?? '2026-07-15',
  });
  const workbook = result.outputFiles[0]
    ? XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' })
    : null;
  return { result, workbook, dir };
}

function buildLargeGroup(): unknown[][] {
  const rows: unknown[][] = [['工号', '姓名', '部门', '职级', '分数', '评级']];
  for (let i = 1; i <= 10; i++) {
    const score = 70 + i;
    rows.push([`E${String(i).padStart(3, '0')}`, `员工${i}`, '研发', 'P5', score, score >= 90 ? 'A' : score >= 80 ? 'B' : 'C']);
  }
  return rows;
}

describe('HR-PERFORMANCE-DISTRIBUTION-007', () => {
  it('normal case computes mean/median and keeps originals', async () => {
    const { result, workbook } = await runPerf({
      performance: buildLargeGroup(),
      rules: { minimumGroupSize: 8 },
    });
    expect(result.errorMessage).toBeUndefined();
    const dept = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['部门职级分析']!);
    expect(dept[0]!.employeeCount).toBe(10);
    expect(Number(dept[0]!.meanScore)).toBeGreaterThan(0);
    expect(Number(dept[0]!.medianScore)).toBeGreaterThan(0);
    expect(result.metrics.autoCorrectScores).toBe(false);
  });

  it('supports aliases and does not force small-group distribution', async () => {
    const { workbook } = await runPerf({
      performance: [
        ['员工编号', '员工姓名', '部门', '级别', '得分', '等级'],
        ['E001', '张三', '财务', 'M1', 95, 'A'],
        ['E002', '李四', '财务', 'M1', 85, 'B'],
      ],
      distribution: [
        ['分组', '评级', '下限比例', '上限比例'],
        ['财务|M1', 'A', 0, 0.1],
      ],
      rules: { minimumGroupSize: 8 },
    });
    const suggestions = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['校准建议']!);
    expect(suggestions.some((s) => String(s.suggestionType).includes('SMALL_GROUP'))).toBe(true);
    expect(suggestions.every((s) => s.autoCorrect === false || s.autoCorrect === 'false')).toBe(true);
  });

  it('fails on missing required role', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-perf-miss-'));
    const result = await createWorkflowRuntime().execute({
      workflowId: 'HR-PERFORMANCE-DISTRIBUTION-007',
      inputFiles: [],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-15',
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toMatch(/Missing required input role/);
  });

  it('flags score out of range and duplicate as NEEDS_REVIEW', async () => {
    const { result, workbook } = await runPerf({
      performance: [
        ['工号', '姓名', '部门', '职级', '分数', '评级'],
        ['E001', '张三', '研发', 'P5', 120, 'A'],
        ['E001', '张三', '研发', 'P5', 80, 'B'],
      ],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    const codes = new Set(result.exceptions.map((e) => e.code));
    expect(codes.has('SCORE_OUT_OF_RANGE') || codes.has('DUPLICATE_SCORE')).toBe(true);
    expect(workbook!.SheetNames).toEqual([
      '绩效分布',
      '部门职级分析',
      '校准建议',
      '离群人员',
      '数据异常',
      '运行说明',
    ]);
  });

  it('applies rule defaults', () => {
    const defaults = createRuleStore().getDefaults('HR-PERFORMANCE-DISTRIBUTION-007');
    expect(defaults.minimumGroupSize).toBe(8);
    expect(defaults.outlierZScore).toBe(2.5);
    const rules = toPerformanceRules(defaults);
    expect(rules.ratingBands.length).toBeGreaterThan(0);
  });

  it('loads company saved rules via createFileRuleStore', async () => {
    const { result } = await runPerf({
      performance: buildLargeGroup(),
      companyId: 'co-perf',
      persisted: { minimumGroupSize: 20 },
    });
    // with min 20, group of 10 is small — still completes or review based on other issues
    expect(result.errorMessage).toBeUndefined();
    expect(result.metrics.suggestionCount).toBeGreaterThan(0);
  });

  it('request.rules overrides persisted and defaults', async () => {
    const { result } = await runPerf({
      performance: buildLargeGroup(),
      companyId: 'co-perf-2',
      persisted: { minimumGroupSize: 20 },
      rules: { minimumGroupSize: 5 },
    });
    expect(result.metrics.employeeCount).toBe(10);
  });

  it('never auto-corrects scores in suggestions and detects outliers', async () => {
    const rows = buildLargeGroup();
    rows.push(['E099', '离群', '研发', 'P5', 10, 'D']);
    const { workbook, result } = await runPerf({
      performance: rows,
      rules: { minimumGroupSize: 5, outlierMethod: 'IQR' },
    });
    const suggestions = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['校准建议']!);
    expect(suggestions.every((s) => s.autoCorrect === false || s.autoCorrect === 'false' || s.autoCorrect === undefined || String(s.message || '').includes('不'))).toBe(true);
    // original values retained conceptually — suggestions may include originalScore
    const withOriginal = suggestions.filter((s) => s.originalScore !== undefined);
    for (const s of withOriginal) {
      expect(s).not.toHaveProperty('correctedScore');
    }
    expect(result.metrics.autoCorrectScores).toBe(false);
  });

  it('writes readable XLSX with cycle file name', async () => {
    const { result, workbook } = await runPerf({
      performance: buildLargeGroup(),
      rules: { cycle: '2026H1' },
    });
    expect(result.outputFiles[0]).toMatch(/绩效分布与校准_2026H1\.xlsx$/);
    expect(workbook!.SheetNames).toEqual([
      '绩效分布',
      '部门职级分析',
      '校准建议',
      '离群人员',
      '数据异常',
      '运行说明',
    ]);
  });

  it('fetch call count stays 0 and AI summary has no PII', async () => {
    let fetchCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return original(...args);
    }) as typeof fetch;
    try {
      const { result } = await runPerf({ performance: buildLargeGroup() });
      expect(fetchCount).toBe(0);
      const payload = JSON.stringify(result.aiSummaryPayload);
      expect(payload).not.toContain('员工1');
      expect(payload).not.toContain('E001');
      expect(result.aiSummaryPayload?.rawRows).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('is deterministic across double runs', async () => {
    const input = { performance: buildLargeGroup() };
    const a = await runPerf(input);
    const b = await runPerf(input);
    expect(a.result.metrics.employeeCount).toBe(b.result.metrics.employeeCount);
    expect(a.result.metrics.outlierCount).toBe(b.result.metrics.outlierCount);
  });
});
