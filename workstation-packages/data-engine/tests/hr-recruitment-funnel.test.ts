import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createFileRuleStore,
  createRuleStore,
  createWorkflowRuntime,
  toRecruitmentRules,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

type RunOpts = {
  candidates: unknown[][];
  plan?: unknown[][];
  rules?: Record<string, unknown>;
  companyId?: string;
  persisted?: Record<string, unknown>;
  runDate?: string;
};

async function runRecruit(options: RunOpts) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-recruit-'));
  const candPath = join(dir, 'cand.xlsx');
  writeSheet(candPath, options.candidates);
  const inputFiles: Array<{ role: string; path: string }> = [{ role: 'candidates', path: candPath }];
  if (options.plan) {
    const p = join(dir, 'plan.xlsx');
    writeSheet(p, options.plan);
    inputFiles.push({ role: 'headcount_plan', path: p });
  }
  const persistedRuleStore = createFileRuleStore({ rootDir: dir });
  if (options.companyId && options.persisted) {
    await persistedRuleStore.saveWorkflowRules(options.companyId, 'HR-RECRUITMENT-FUNNEL-006', options.persisted);
  }
  const runtime = createWorkflowRuntime({ persistedRuleStore });
  const result = await runtime.execute({
    workflowId: 'HR-RECRUITMENT-FUNNEL-006',
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

const normalCandidates = [
  ['候选人编号', '姓名', '职位', '来源', '阶段', '阶段日期', '手机'],
  ['C001', '甲', '工程师', '猎头', 'NEW', '2026-06-01', '13800000001'],
  ['C002', '乙', '工程师', '官网', 'INTERVIEW', '2026-06-10', '13800000002'],
  ['C003', '丙', '工程师', '猎头', 'HIRED', '2026-07-01', '13800000003'],
];

describe('HR-RECRUITMENT-FUNNEL-006', () => {
  it('normal case builds funnel without double-counting', async () => {
    const { result, workbook } = await runRecruit({ candidates: normalCandidates });
    expect(result.errorMessage).toBeUndefined();
    const funnel = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['招聘漏斗']!);
    const newRow = funnel.find((r) => r.stage === 'NEW');
    const hiredRow = funnel.find((r) => r.stage === 'HIRED');
    expect(Number(newRow!.uniqueCandidates)).toBe(3);
    expect(Number(hiredRow!.uniqueCandidates)).toBe(1);
    expect(result.metrics.uniqueCandidates).toBe(3);
  });

  it('supports aliases and hiring gap', async () => {
    const { workbook } = await runRecruit({
      candidates: [
        ['候选人ID', '候选人', '岗位', '渠道', '状态', '日期'],
        ['C010', '丁', '产品', '内推', '入职', '2026-07-01'],
      ],
      plan: [
        ['职位', '计划人数', '目标日期'],
        ['产品', 2, '2026-08-01'],
      ],
    });
    const gap = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['招聘缺口']!);
    expect(gap[0]!.hiringGap).toBe(1);
  });

  it('fails on missing required role', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-recruit-miss-'));
    const result = await createWorkflowRuntime().execute({
      workflowId: 'HR-RECRUITMENT-FUNNEL-006',
      inputFiles: [],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-15',
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toMatch(/Missing required input role/);
  });

  it('deduplicates candidates and flags duplicates', async () => {
    const { result, workbook } = await runRecruit({
      candidates: [
        ['候选人编号', '姓名', '职位', '来源', '阶段', '阶段日期', '手机'],
        ['C001', '甲', '工程师', '猎头', 'NEW', '2026-06-01', '13800000001'],
        ['C001', '甲', '工程师', '猎头', 'SCREENING', '2026-06-05', '13800000001'],
        ['C009', '甲', '工程师', '官网', 'NEW', '2026-06-02', '13800000001'],
      ],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.some((e) => e.code === 'DUPLICATE_CANDIDATE')).toBe(true);
    expect(Number(result.metrics.uniqueCandidates)).toBeLessThan(3);
    expect(XLSX.utils.sheet_to_json(workbook!.Sheets['重复候选人']!).length).toBeGreaterThan(0);
  });

  it('applies rule defaults', () => {
    const defaults = createRuleStore().getDefaults('HR-RECRUITMENT-FUNNEL-006');
    expect(defaults.staleDays).toBe(14);
    const rules = toRecruitmentRules(defaults);
    expect(rules.stageOrder[0]).toBe('NEW');
  });

  it('loads company saved rules via createFileRuleStore', async () => {
    const { workbook } = await runRecruit({
      candidates: [
        ['候选人编号', '姓名', '职位', '来源', '阶段', '阶段日期'],
        ['C001', '甲', '工程师', '猎头', 'INTERVIEW', '2026-06-01'],
      ],
      companyId: 'co-recruit',
      persisted: { staleDays: 5 },
      runDate: '2026-07-15',
    });
    expect(XLSX.utils.sheet_to_json(workbook!.Sheets['停滞候选人']!).length).toBe(1);
  });

  it('request.rules overrides persisted and defaults', async () => {
    const { workbook } = await runRecruit({
      candidates: [
        ['候选人编号', '姓名', '职位', '来源', '阶段', '阶段日期'],
        ['C001', '甲', '工程师', '猎头', 'INTERVIEW', '2026-06-01'],
      ],
      companyId: 'co-recruit-2',
      persisted: { staleDays: 5 },
      rules: { staleDays: 100 },
      runDate: '2026-07-15',
    });
    expect(XLSX.utils.sheet_to_json(workbook!.Sheets['停滞候选人']!).length).toBe(0);
  });

  it('writes readable XLSX with correct sheet names', async () => {
    const { result, workbook } = await runRecruit({
      candidates: normalCandidates,
      plan: [['职位', '计划人数'], ['工程师', 5]],
    });
    expect(result.outputFiles[0]).toMatch(/招聘漏斗分析_2026-07-15\.xlsx$/);
    expect(workbook!.SheetNames).toEqual([
      '招聘漏斗',
      '来源转化',
      '职位转化',
      '停滞候选人',
      '招聘缺口',
      '重复候选人',
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
      const { result } = await runRecruit({ candidates: normalCandidates });
      expect(fetchCount).toBe(0);
      const payload = JSON.stringify(result.aiSummaryPayload);
      expect(payload).not.toContain('甲');
      expect(payload).not.toContain('C001');
      expect(payload).not.toContain('13800000001');
      expect(result.aiSummaryPayload?.rawRows).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('is deterministic across double runs', async () => {
    const a = await runRecruit({ candidates: normalCandidates });
    const b = await runRecruit({ candidates: normalCandidates });
    expect(a.result.metrics.uniqueCandidates).toBe(b.result.metrics.uniqueCandidates);
    expect(a.result.metrics.hiredCount).toBe(b.result.metrics.hiredCount);
  });
});
