import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createWorkflowRuntime,
  deduplicateByVersion,
  normalizePlanStatus,
  roundQty,
  sortProductionPlans,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

async function runPlan(options: {
  plan: unknown[][];
  stock?: unknown[][];
  capacity?: unknown[][];
  orders?: unknown[][];
  rules?: Record<string, unknown>;
  runDate?: string;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-plan-'));
  const planPath = join(dir, 'plan.xlsx');
  writeSheet(planPath, options.plan);
  const inputFiles = [{ role: 'production_plan', path: planPath }];
  if (options.stock) {
    const stockPath = join(dir, 'stock.xlsx');
    writeSheet(stockPath, options.stock);
    inputFiles.push({ role: 'finished_stock', path: stockPath });
  }
  if (options.capacity) {
    const capacityPath = join(dir, 'capacity.xlsx');
    writeSheet(capacityPath, options.capacity);
    inputFiles.push({ role: 'capacity', path: capacityPath });
  }
  if (options.orders) {
    const orderPath = join(dir, 'orders.xlsx');
    writeSheet(orderPath, options.orders);
    inputFiles.push({ role: 'customer_orders', path: orderPath });
  }
  const runtime = createWorkflowRuntime();
  const result = await runtime.execute({
    workflowId: 'PROD-PLAN-CLEAN-003',
    inputFiles,
    rules: options.rules,
    outputDir: join(dir, 'out'),
    runDate: options.runDate ?? '2026-07-22',
  });
  const workbook = result.outputFiles[0]
    ? XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' })
    : null;
  return { result, workbook, dir };
}

describe('plan operators', () => {
  it('normalizes status aliases and dedupes versions deterministically', () => {
    expect(normalizePlanStatus('已审核')).toBe('APPROVED');
    expect(normalizePlanStatus('已取消')).toBe('CANCELLED');
    expect(normalizePlanStatus('???')).toBe('UNKNOWN');

    const deduped = deduplicateByVersion([
      {
        planNo: 'P1',
        productCode: 'A',
        version: 1,
        updatedAt: '2026-07-01',
        planQty: 10,
        _sourceFile: 'a',
        _sourceSheet: 's',
        _sourceRow: 2,
      },
      {
        planNo: 'P1',
        productCode: 'A',
        version: 2,
        updatedAt: '2026-07-02',
        planQty: 12,
        _sourceFile: 'a',
        _sourceSheet: 's',
        _sourceRow: 3,
      },
    ]);
    expect(deduped.selected).toHaveLength(1);
    expect(deduped.selected[0]?.version).toBe(2);
    expect(deduped.discarded).toHaveLength(1);

    const sorted = sortProductionPlans([
      { planNo: 'B', productCode: 'P', dueDate: '2026-07-25', overdue: false },
      { planNo: 'A', productCode: 'P', dueDate: '2026-07-20', overdue: true },
      { planNo: 'C', productCode: 'P', dueDate: '2026-07-21', overdue: false },
    ]);
    expect(sorted.map((row) => row.planNo)).toEqual(['A', 'C', 'B']);
  });
});

describe('PROD-PLAN-CLEAN-003 unit cases', () => {
  it('1 sample READY with stock and capacity', async () => {
    const { result, workbook } = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '计划开始日期', '交期', '状态', '产线'],
        ['PLAN-001', 'P-100', 200, '2026-07-24', '2026-07-28', '已审核', 'LINE-01'],
      ],
      stock: [
        ['产品编码', '可用库存', '预留库存'],
        ['P-100', 50, 10],
      ],
      capacity: [
        ['产线', '日期', '可用工时', '每小时产量'],
        ['LINE-01', '2026-07-24', 8, 20],
      ],
    });
    expect(result.errorMessage).toBeUndefined();
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook!.Sheets['可执行计划']!,
    );
    const row = rows[0]!;
    expect(roundQty(Number(row.netAvailableQty))).toBe(40);
    expect(roundQty(Number(row.netRequiredQty))).toBe(160);
    expect(roundQty(Number(row.requiredHours))).toBe(8);
    expect(roundQty(Number(row.capacityGapHours))).toBe(0);
    expect(Number(row.daysToDue)).toBe(6);
    expect(row.resultStatus).toBe('READY');
  });

  it('2-5: exact duplicate, version, updatedAt, conflict', async () => {
    const exact = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-1', 'P-1', 10, '2026-07-30', '已审核'],
        ['PLAN-1', 'P-1', 10, '2026-07-30', '已审核'],
      ],
    });
    expect(exact.result.metrics.selectedPlanCount).toBe(1);

    const version = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态', '版本', '更新时间'],
        ['PLAN-1', 'P-1', 10, '2026-07-30', '已审核', 1, '2026-07-01'],
        ['PLAN-1', 'P-1', 12, '2026-07-30', '已审核', 2, '2026-07-02'],
      ],
    });
    const vRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      version.workbook!.Sheets['可执行计划']!,
    );
    expect(Number(vRows[0]!.planQty)).toBe(12);

    const updated = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态', '版本', '更新时间'],
        ['PLAN-1', 'P-1', 10, '2026-07-30', '已审核', 2, '2026-07-01'],
        ['PLAN-1', 'P-1', 15, '2026-07-30', '已审核', 2, '2026-07-10'],
      ],
    });
    const uRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      updated.workbook!.Sheets['可执行计划']!,
    );
    expect(Number(uRows[0]!.planQty)).toBe(15);

    const conflict = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-1', 'P-1', 10, '2026-07-30', '已审核'],
        ['PLAN-1', 'P-1', 20, '2026-07-30', '已审核'],
      ],
    });
    expect(conflict.result.status).toBe('NEEDS_REVIEW');
    expect(
      conflict.result.exceptions.some((item) => item.code === 'DUPLICATE_CONFLICT'),
    ).toBe(true);
  });

  it('6-9: stock cover/partial/reserved/no stock file', async () => {
    const covered = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-1', 'P-1', 10, '2026-07-30', '已审核'],
      ],
      stock: [
        ['产品编码', '可用库存', '预留库存'],
        ['P-1', 20, 5],
      ],
    });
    expect(Number(covered.result.metrics.stockCoveredCount)).toBe(1);

    const partial = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-1', 'P-1', 20, '2026-07-30', '已审核'],
      ],
      stock: [
        ['产品编码', '可用库存', '预留库存'],
        ['P-1', 20, 5],
      ],
    });
    const pRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      partial.workbook!.Sheets['可执行计划']!,
    );
    expect(Number(pRows[0]!.netAvailableQty)).toBe(15);
    expect(Number(pRows[0]!.netRequiredQty)).toBe(5);

    const noStock = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-1', 'P-1', 10, '2026-07-30', '已审核'],
      ],
    });
    expect(Number(noStock.result.metrics.executableCount)).toBe(1);
  });

  it('10-12: capacity enough/shortage/unchecked', async () => {
    const enough = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '计划开始日期', '交期', '状态', '产线'],
        ['PLAN-1', 'P-1', 100, '2026-07-24', '2026-07-30', '已审核', 'L1'],
      ],
      capacity: [
        ['产线', '日期', '可用工时', '每小时产量'],
        ['L1', '2026-07-24', 10, 20],
      ],
    });
    expect(Number(enough.result.metrics.capacityShortageCount)).toBe(0);
    expect(enough.result.metrics.capacityChecked).toBe(true);

    const shortage = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '计划开始日期', '交期', '状态', '产线'],
        ['PLAN-1', 'P-1', 100, '2026-07-24', '2026-07-30', '已审核', 'L1'],
      ],
      capacity: [
        ['产线', '日期', '可用工时', '每小时产量'],
        ['L1', '2026-07-24', 1, 20],
      ],
    });
    expect(Number(shortage.result.metrics.capacityShortageCount)).toBe(1);
    expect(shortage.result.status).toBe('NEEDS_REVIEW');

    const unchecked = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-1', 'P-1', 10, '2026-07-30', '已审核'],
      ],
    });
    expect(unchecked.result.metrics.capacityChecked).toBe(false);
  });

  it('13-18: overdue, freeze, statuses', async () => {
    const overdue = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-1', 'P-1', 10, '2026-07-20', '已审核'],
      ],
    });
    expect(Number(overdue.result.metrics.overdueCount)).toBe(1);

    const freezeChange = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '计划开始日期', '交期', '状态', '版本', '更新时间'],
        ['PLAN-1', 'P-1', 10, '2026-07-24', '2026-07-30', '已审核', 1, '2026-07-01'],
        ['PLAN-1', 'P-1', 12, '2026-07-24', '2026-07-30', '已审核', 2, '2026-07-20'],
      ],
      rules: { freezeDays: 3 },
    });
    expect(freezeChange.result.status).toBe('NEEDS_REVIEW');
    expect(
      freezeChange.result.exceptions.some((item) => item.code === 'FROZEN_CHANGE'),
    ).toBe(true);

    const alias = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-1', 'P-1', 10, '2026-07-30', '已下达'],
      ],
    });
    expect(Number(alias.result.metrics.executableCount)).toBe(1);

    const ignored = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-1', 'P-1', 10, '2026-07-30', '已完成'],
        ['PLAN-2', 'P-1', 10, '2026-07-30', '已取消'],
      ],
    });
    expect(Number(ignored.result.metrics.executableCount)).toBe(0);
    expect(Number(ignored.result.metrics.blockedCount)).toBe(2);

    const unknown = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-1', 'P-1', 10, '2026-07-30', '奇怪状态'],
      ],
    });
    expect(unknown.result.status).toBe('NEEDS_REVIEW');
  });

  it('19-20: invalid qty and missing fields', async () => {
    const zero = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-1', 'P-1', 0, '2026-07-30', '已审核'],
      ],
    });
    expect(zero.result.status).toBe('NEEDS_REVIEW');

    const missing = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['', 'P-1', 10, '2026-07-30', '已审核'],
      ],
    });
    expect(missing.result.status).toBe('NEEDS_REVIEW');
  });

  it('21-25: date formats in plan dueDate', async () => {
    const target = Date.UTC(2026, 6, 28);
    const serial1900 = Math.round((target - Date.UTC(1899, 11, 30)) / 86_400_000);
    const serial1904 = Math.round((target - Date.UTC(1904, 0, 1)) / 86_400_000);

    const ymd = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-1', 'P-1', 10, '2026-07-28', '已审核'],
      ],
    });
    expect(Number(ymd.result.metrics.executableCount)).toBe(1);

    const cn = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-1', 'P-1', 10, '2026年07月28日', '已审核'],
      ],
    });
    expect(Number(cn.result.metrics.executableCount)).toBe(1);

    const excel1900 = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-1', 'P-1', 10, serial1900, '已审核'],
      ],
    });
    expect(Number(excel1900.result.metrics.executableCount)).toBe(1);

    const excel1904 = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-1', 'P-1', 10, serial1904, '已审核'],
      ],
      rules: { excelDateSystem: '1904' },
    });
    expect(Number(excel1904.result.metrics.executableCount)).toBe(1);

    const ambiguous = await runPlan({
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-1', 'P-1', 10, '07/08/2026', '已审核'],
      ],
    });
    expect(ambiguous.result.status).toBe('NEEDS_REVIEW');
  });

  it('27/34: deterministic sort and repeated runs', async () => {
    const input = {
      plan: [
        ['计划号', '产品编码', '计划数量', '交期', '状态'],
        ['PLAN-B', 'P-1', 10, '2026-07-28', '已审核'],
        ['PLAN-A', 'P-1', 10, '2026-07-25', '已审核'],
        ['PLAN-C', 'P-1', 10, '2026-07-20', '已审核'],
      ] as unknown[][],
    };
    const a = await runPlan(input);
    const b = await runPlan(input);
    const rowsA = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      a.workbook!.Sheets['可执行计划']!,
    );
    const rowsB = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      b.workbook!.Sheets['可执行计划']!,
    );
    expect(rowsA.map((row) => row.planNo)).toEqual(['PLAN-C', 'PLAN-A', 'PLAN-B']);
    expect(rowsA.map((row) => row.planNo)).toEqual(rowsB.map((row) => row.planNo));
    expect(a.result.metrics.executableNetRequiredQtyTotal).toBe(
      b.result.metrics.executableNetRequiredQtyTotal,
    );
  });
});
