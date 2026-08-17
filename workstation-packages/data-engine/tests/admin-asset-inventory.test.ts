import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createRuleStore,
  createWorkflowRuntime,
  daysUntil,
  normalizeAssetStatus,
  sanitizeAdminSummary,
  toAdminAssetRules,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

describe('ADMIN-ASSET-INVENTORY-001', () => {
  it('helpers and rule defaults', () => {
    expect(normalizeAssetStatus('闲置')).toBe('IDLE');
    expect(daysUntil('2026-07-01', '2026-07-31')).toBe(30);
    expect(sanitizeAdminSummary({ rawRows: true, metrics: { a: 1 } }).rawRows).toBe(false);
    const rules = toAdminAssetRules(createRuleStore().getDefaults('ADMIN-ASSET-INVENTORY-001'));
    expect(rules.matchRule).toBe('ASSET_CODE');
    expect(rules.idleDays).toBe(90);
    expect(rules.expiryWarningDays).toBe(30);
  });

  it('flags shortage/surplus/location and never auto-updates ledger', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-admin-asset-'));
    const register = join(dir, 'register.xlsx');
    const count = join(dir, 'count.xlsx');
    const maint = join(dir, 'maint.xlsx');
    writeSheet(register, [
      ['资产编号', '资产名称', '类别', '部门', '责任人', '位置', '状态'],
      ['A1', '笔记本', 'IT', '行政', '张三', 'A座101', '在用'],
      ['A2', '显示器', 'IT', '行政', '李四', 'A座102', '闲置'],
    ]);
    writeSheet(count, [
      ['资产编号', '实盘位置', '实盘责任人', '实盘状态', '盘点日期'],
      ['A1', 'B座201', '张三', '在用', '2026-07-20'],
      ['A3', '仓库', '王五', '在用', '2026-07-20'],
    ]);
    writeSheet(maint, [
      ['资产编号', '质保到期', '下次维保'],
      ['A1', '2026-08-01', '2026-07-25'],
    ]);

    const result = await createWorkflowRuntime().execute({
      workflowId: 'ADMIN-ASSET-INVENTORY-001',
      inputFiles: [
        { role: 'asset_register', path: register },
        { role: 'physical_count', path: count },
        { role: 'maintenance', path: maint },
      ],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-22',
    });

    expect(result.errorMessage).toBeUndefined();
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.metrics.autoUpdateLedger).toBe(false);
    expect(result.metrics.cloudUpload).toBe(false);
    expect(result.outputFiles[0]).toMatch(/资产盘点结果_/);

    const wb = XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' });
    expect(wb.SheetNames).toEqual(
      expect.arrayContaining([
        '盘点总表',
        '盘亏',
        '盘盈',
        '位置责任人异常',
        '损坏闲置',
        '维保提醒',
        '运行说明',
      ]),
    );
    const shortage = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['盘亏']!);
    const surplus = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['盘盈']!);
    expect(shortage.some((r) => r.assetCode === 'A2')).toBe(true);
    expect(surplus.some((r) => r.assetCode === 'A3')).toBe(true);
  });

  it('missing required inputs fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-admin-asset-miss-'));
    const result = await createWorkflowRuntime().execute({
      workflowId: 'ADMIN-ASSET-INVENTORY-001',
      inputFiles: [],
      outputDir: join(dir, 'out'),
    });
    expect(result.status).toBe('FAILED');
  });
});
