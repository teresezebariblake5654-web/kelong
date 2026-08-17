import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createFileRuleStore,
  createRuleStore,
  createWorkflowRuntime,
  toOnboardOffboardRules,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

type RunOpts = {
  changes: unknown[][];
  template: unknown[][];
  status?: unknown[][];
  rules?: Record<string, unknown>;
  companyId?: string;
  persisted?: Record<string, unknown>;
  runDate?: string;
};

async function runOnboard(options: RunOpts) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-onoff-'));
  const changePath = join(dir, 'change.xlsx');
  const tplPath = join(dir, 'tpl.xlsx');
  writeSheet(changePath, options.changes);
  writeSheet(tplPath, options.template);
  const inputFiles: Array<{ role: string; path: string }> = [
    { role: 'employee_changes', path: changePath },
    { role: 'task_template', path: tplPath },
  ];
  if (options.status) {
    const p = join(dir, 'status.xlsx');
    writeSheet(p, options.status);
    inputFiles.push({ role: 'task_status', path: p });
  }
  const persistedRuleStore = createFileRuleStore({ rootDir: dir });
  if (options.companyId && options.persisted) {
    await persistedRuleStore.saveWorkflowRules(options.companyId, 'HR-ONBOARD-OFFBOARD-004', options.persisted);
  }
  const runtime = createWorkflowRuntime({ persistedRuleStore });
  const result = await runtime.execute({
    workflowId: 'HR-ONBOARD-OFFBOARD-004',
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

const normalChanges = [
  ['工号', '姓名', '变动类型', '生效日期', '部门', '岗位'],
  ['E001', '张三', '入职', '2026-07-01', '研发', '工程师'],
];
const normalTemplate = [
  ['变动类型', '部门', '任务名称', '负责角色', '截止偏移天', '是否阻塞'],
  ['ONBOARD', '研发', '合同签署', 'HR', 1, '是'],
  ['ONBOARD', '研发', '账号开通', 'IT', 2, '是'],
  ['ONBOARD', '*', '欢迎邮件', 'HR', 0, '否'],
];

describe('HR-ONBOARD-OFFBOARD-004', () => {
  it('normal case expands templates and computes completionRate', async () => {
    const { result, workbook } = await runOnboard({
      changes: normalChanges,
      template: normalTemplate,
      status: [
        ['工号', '任务名称', '状态', '完成时间'],
        ['E001', '合同签署', '完成', '2026-07-01'],
        ['E001', '账号开通', '完成', '2026-07-02'],
        ['E001', '欢迎邮件', '完成', '2026-07-01'],
      ],
    });
    expect(result.errorMessage).toBeUndefined();
    expect(result.status).toBe('COMPLETED');
    const overview = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['人员总览']!);
    expect(overview[0]!.totalTasks).toBe(3);
    expect(overview[0]!.completionRate).toBe(1);
    expect(overview[0]!.closeStatus).toBe('READY_TO_CLOSE');
    expect(result.metrics.autoAccountAssetOps).toBe(false);
  });

  it('supports Chinese aliases and TRANSFER/OFFBOARD', async () => {
    const { result, workbook } = await runOnboard({
      changes: [
        ['员工编号', '员工姓名', '类型', '生效日', '部门', '职位'],
        ['E002', '李四', '离职', '2026-07-10', '财务', '会计'],
      ],
      template: [
        ['类型', '部门', '任务', '角色', '偏移天数'],
        ['OFFBOARD', '财务', '资产归还', 'ADMIN', 1],
        ['OFFBOARD', '财务', '账号停用', 'IT', 0],
      ],
    });
    expect(result.errorMessage).toBeUndefined();
    const overview = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['人员总览']!);
    expect(overview[0]!.changeType).toBe('OFFBOARD');
    expect(overview[0]!.closeStatus).toBe('BLOCKED');
  });

  it('fails on missing required role', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-onoff-miss-'));
    const changePath = join(dir, 'change.xlsx');
    writeSheet(changePath, normalChanges);
    const result = await createWorkflowRuntime().execute({
      workflowId: 'HR-ONBOARD-OFFBOARD-004',
      inputFiles: [{ role: 'employee_changes', path: changePath }],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-15',
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toMatch(/Missing required input role/);
  });

  it('flags overdue and blocking via task names', async () => {
    const { result, workbook } = await runOnboard({
      changes: normalChanges,
      template: normalTemplate,
      status: [
        ['工号', '任务名称', '状态'],
        ['E001', '欢迎邮件', '完成'],
      ],
      runDate: '2026-07-15',
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.some((e) => e.code === 'CLOSE_BLOCKED' || e.code === 'ACCOUNT_OPEN')).toBe(true);
    expect(XLSX.utils.sheet_to_json(workbook!.Sheets['阻塞办结']!).length).toBeGreaterThan(0);
    expect(XLSX.utils.sheet_to_json(workbook!.Sheets['逾期任务']!).length).toBeGreaterThan(0);
  });

  it('applies rule defaults', () => {
    const defaults = createRuleStore().getDefaults('HR-ONBOARD-OFFBOARD-004');
    expect(defaults.reminderDays).toBe(3);
    const rules = toOnboardOffboardRules(defaults);
    expect(rules.blockingTasks.length).toBeGreaterThan(0);
  });

  it('loads company saved rules via createFileRuleStore', async () => {
    const { result } = await runOnboard({
      changes: normalChanges,
      template: [
        ['变动类型', '部门', '任务名称', '负责角色', '截止偏移天'],
        ['ONBOARD', '研发', '自定义阻塞', 'HR', 1],
      ],
      companyId: 'co-onoff',
      persisted: { blockingTasks: ['自定义阻塞'] },
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.some((e) => e.code === 'CLOSE_BLOCKED')).toBe(true);
  });

  it('request.rules overrides persisted and defaults', async () => {
    const { result } = await runOnboard({
      changes: normalChanges,
      template: [
        ['变动类型', '部门', '任务名称', '负责角色', '截止偏移天'],
        ['ONBOARD', '研发', '欢迎邮件', 'HR', 0],
      ],
      companyId: 'co-onoff-2',
      persisted: { blockingTasks: ['欢迎邮件'] },
      rules: { blockingTasks: [] },
      status: [['工号', '任务名称', '状态'], ['E001', '欢迎邮件', '完成']],
    });
    expect(result.status).toBe('COMPLETED');
  });

  it('writes readable XLSX with correct sheet names', async () => {
    const { result, workbook } = await runOnboard({
      changes: normalChanges,
      template: normalTemplate,
      status: [
        ['工号', '任务名称', '状态', '完成时间'],
        ['E001', '合同签署', '完成', '2026-07-01'],
        ['E001', '账号开通', '完成', '2026-07-02'],
        ['E001', '欢迎邮件', '完成', '2026-07-01'],
      ],
    });
    expect(result.outputFiles[0]).toMatch(/入离职任务处理_2026-07-15\.xlsx$/);
    expect(workbook!.SheetNames).toEqual([
      '人员总览',
      '待办任务',
      '已完成任务',
      '逾期任务',
      '阻塞办结',
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
      const { result } = await runOnboard({
        changes: normalChanges,
        template: normalTemplate,
        status: [
          ['工号', '任务名称', '状态'],
          ['E001', '合同签署', '完成'],
          ['E001', '账号开通', '完成'],
          ['E001', '欢迎邮件', '完成'],
        ],
      });
      expect(fetchCount).toBe(0);
      const payload = JSON.stringify(result.aiSummaryPayload);
      expect(payload).not.toContain('张三');
      expect(payload).not.toContain('E001');
      expect(result.aiSummaryPayload?.rawRows).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('is deterministic across double runs', async () => {
    const input = {
      changes: normalChanges,
      template: normalTemplate,
      status: [
        ['工号', '任务名称', '状态'],
        ['E001', '合同签署', '完成'],
        ['E001', '账号开通', '完成'],
        ['E001', '欢迎邮件', '完成'],
      ],
    };
    const a = await runOnboard(input);
    const b = await runOnboard(input);
    expect(a.result.metrics.taskCount).toBe(b.result.metrics.taskCount);
    expect(a.result.metrics.completedCount).toBe(b.result.metrics.completedCount);
  });
});
