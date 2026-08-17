import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createRuleStore,
  createWorkflowRuntime,
  toAdminContractRules,
  toAdminExpenseRules,
  toAdminRoomRules,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

describe('Admin wave e2e — all 4 workflows', () => {
  it('rule defaults for all ADMIN ids', () => {
    const store = createRuleStore();
    expect(toAdminExpenseRules(store.getDefaults('ADMIN-EXPENSE-ANALYSIS-002')).period).toBe('MONTH');
    expect(toAdminExpenseRules(store.getDefaults('ADMIN-EXPENSE-ANALYSIS-002')).materialityRate).toBe(0.1);
    expect(toAdminRoomRules(store.getDefaults('ADMIN-ROOM-UTILIZATION-003')).workingDays).toBe(5);
    expect(toAdminRoomRules(store.getDefaults('ADMIN-ROOM-UTILIZATION-003')).noShowGraceMinutes).toBe(15);
    expect(toAdminContractRules(store.getDefaults('ADMIN-CONTRACT-EXPIRY-004')).warningDays).toBe(30);
    expect(toAdminContractRules(store.getDefaults('ADMIN-CONTRACT-EXPIRY-004')).materialAmount).toBe('10000');
  });

  it('executes all admin workflows, asserts sheets and never-auto flags', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-admin-wave-'));
    const out = join(dir, 'out');
    const runtime = createWorkflowRuntime();
    let fetchCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return original(...args);
    }) as typeof fetch;

    try {
      const register = join(dir, 'register.xlsx');
      const count = join(dir, 'count.xlsx');
      writeSheet(register, [
        ['资产编号', '资产名称', '类别', '部门', '责任人', '位置', '状态'],
        ['A1', '笔记本', 'IT', '行政', '张三', 'A座', '在用'],
      ]);
      writeSheet(count, [
        ['资产编号', '实盘位置', '实盘责任人', '实盘状态', '盘点日期'],
        ['A1', 'A座', '张三', '在用', '2026-07-20'],
      ]);
      const assetResult = await runtime.execute({
        workflowId: 'ADMIN-ASSET-INVENTORY-001',
        inputFiles: [
          { role: 'asset_register', path: register },
          { role: 'physical_count', path: count },
        ],
        outputDir: out,
        runDate: '2026-07-22',
      });

      const expense = join(dir, 'expense.xlsx');
      writeSheet(expense, [
        ['日期', '部门', '费用类别', '供应商', '金额'],
        ['2026-07-01', '行政', '办公', '供应商A', 1000],
        ['2026-06-01', '行政', '办公', '供应商A', 500],
      ]);
      const expenseResult = await runtime.execute({
        workflowId: 'ADMIN-EXPENSE-ANALYSIS-002',
        inputFiles: [{ role: 'admin_expense', path: expense }],
        outputDir: out,
        runDate: '2026-07-22',
      });

      const rooms = join(dir, 'rooms.xlsx');
      const bookings = join(dir, 'bookings.xlsx');
      writeSheet(rooms, [
        ['会议室ID', '会议室名称', '容量', '开放开始', '开放结束'],
        ['R1', '大会议室', 20, '09:00', '18:00'],
      ]);
      writeSheet(bookings, [
        ['会议室ID', '事件ID', '开始时间', '结束时间', '状态', '参会人数'],
        ['R1', 'E1', '2026-07-22 10:00', '2026-07-22 11:00', '已确认', 4],
        ['R1', 'E2', '2026-07-22 10:30', '2026-07-22 11:30', '已确认', 3],
      ]);
      const roomResult = await runtime.execute({
        workflowId: 'ADMIN-ROOM-UTILIZATION-003',
        inputFiles: [
          { role: 'room_master', path: rooms },
          { role: 'bookings', path: bookings },
        ],
        outputDir: out,
        runDate: '2026-07-22',
        companyRules: { useCheckinAsActual: false },
      });

      const contracts = join(dir, 'contracts.xlsx');
      writeSheet(contracts, [
        ['合同号', '合同名称', '对方', '开始日期', '结束日期', '责任人', '金额', '状态', '自动续约'],
        ['C1', '物业合同', '物业公司', '2025-01-01', '2026-08-01', '赵六', 50000, '有效', '是'],
      ]);
      const contractResult = await runtime.execute({
        workflowId: 'ADMIN-CONTRACT-EXPIRY-004',
        inputFiles: [{ role: 'contracts', path: contracts }],
        outputDir: out,
        runDate: '2026-07-22',
      });

      for (const result of [assetResult, expenseResult, roomResult, contractResult]) {
        expect(result.errorMessage).toBeUndefined();
        expect(['COMPLETED', 'NEEDS_REVIEW']).toContain(result.status);
        expect(result.outputFiles[0]).toBeTruthy();
        expect(result.metrics.cloudUpload).toBe(false);
        const wb = XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' });
        expect(wb.SheetNames).toContain('运行说明');
      }

      expect(assetResult.metrics.autoUpdateLedger).toBe(false);
      expect(expenseResult.metrics.autoDispose).toBe(false);
      expect(roomResult.metrics.overlapDoubleCount).toBe(false);
      expect(contractResult.metrics.autoRenew).toBe(false);
      expect(contractResult.metrics.autoTerminate).toBe(false);

      const assetWb = XLSX.read(readFileSync(assetResult.outputFiles[0]!), { type: 'buffer' });
      expect(assetWb.SheetNames).toEqual(
        expect.arrayContaining(['盘点总表', '盘亏', '盘盈', '位置责任人异常', '损坏闲置', '维保提醒']),
      );
      const expenseWb = XLSX.read(readFileSync(expenseResult.outputFiles[0]!), { type: 'buffer' });
      expect(expenseWb.SheetNames).toEqual(
        expect.arrayContaining(['费用总览', '部门分析', '类别分析', '供应商分析', '预算差异', '异常增长']),
      );
      const roomWb = XLSX.read(readFileSync(roomResult.outputFiles[0]!), { type: 'buffer' });
      expect(roomWb.SheetNames).toEqual(
        expect.arrayContaining(['会议室总览', '每日利用率', '高峰时段', '取消爽约', '容量匹配', '数据异常']),
      );
      const daily = XLSX.utils.sheet_to_json<Record<string, unknown>>(roomWb.Sheets['每日利用率']!);
      // Overlapping 10:00-11:00 and 10:30-11:30 => merged 90 minutes, not 120
      expect(Number(daily[0]?.bookedMinutes)).toBe(90);

      const contractWb = XLSX.read(readFileSync(contractResult.outputFiles[0]!), { type: 'buffer' });
      expect(contractWb.SheetNames).toEqual(
        expect.arrayContaining(['合同总表', '即将到期', '已过期', '自动续约', '节点逾期', '资料缺失']),
      );

      expect(fetchCount).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
