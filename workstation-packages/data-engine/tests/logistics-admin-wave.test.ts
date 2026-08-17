import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createWorkflowRuntime } from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

describe('logistics + admin wave smoke', () => {
  it('runs LOG-INVENTORY-COUNT-001', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-log-inv-'));
    const ledger = join(dir, 'ledger.xlsx');
    const count = join(dir, 'count.xlsx');
    writeSheet(ledger, [
      ['SKU', '仓库', '账面数量', '账面日期'],
      ['A1', 'WH1', 10, '2026-07-20'],
    ]);
    writeSheet(count, [
      ['SKU', '仓库', '实盘数量', '盘点日期'],
      ['A1', 'WH1', 8, '2026-07-21'],
    ]);
    const result = await createWorkflowRuntime().execute({
      workflowId: 'LOG-INVENTORY-COUNT-001',
      inputFiles: [
        { role: 'stock_ledger', path: ledger },
        { role: 'physical_count', path: count },
      ],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-22',
    });
    expect(result.errorMessage).toBeUndefined();
    expect(result.metrics.cloudUpload).toBe(false);
    expect(result.metrics.autoAdjustStock).toBe(false);
    expect(result.outputFiles[0]).toMatch(/库存盘点结果/);
    const wb = XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' });
    expect(wb.SheetNames).toEqual(expect.arrayContaining(['盘点总表', '盘亏', '运行说明']));
  });

  it('runs LOG-STOCK-ALERT-004', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-log-alert-'));
    const inv = join(dir, 'inv.xlsx');
    writeSheet(inv, [
      ['SKU', '仓库', '库存', '安全库存'],
      ['A1', 'WH1', 2, 5],
    ]);
    const result = await createWorkflowRuntime().execute({
      workflowId: 'LOG-STOCK-ALERT-004',
      inputFiles: [{ role: 'inventory', path: inv }],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-22',
    });
    expect(result.errorMessage).toBeUndefined();
    expect(result.status === 'COMPLETED' || result.status === 'NEEDS_REVIEW').toBe(true);
    expect(result.metrics.cloudUpload).toBe(false);
    expect(Number(result.metrics.lowStockCount ?? 0)).toBeGreaterThan(0);
  });

  it('runs ADMIN-ASSET-INVENTORY-001', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-admin-asset-'));
    const reg = join(dir, 'reg.xlsx');
    const phy = join(dir, 'phy.xlsx');
    writeSheet(reg, [
      ['资产编号', '资产名称', '类别', '部门', '责任人', '位置', '状态'],
      ['AST1', '电脑', 'IT', '行政', '张三', 'A区', '在用'],
    ]);
    writeSheet(phy, [
      ['资产编号', '实盘位置', '实盘责任人', '实盘状态', '盘点日期'],
      ['AST1', 'B区', '张三', '在用', '2026-07-21'],
    ]);
    const result = await createWorkflowRuntime().execute({
      workflowId: 'ADMIN-ASSET-INVENTORY-001',
      inputFiles: [
        { role: 'asset_register', path: reg },
        { role: 'physical_count', path: phy },
      ],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-22',
    });
    expect(result.errorMessage).toBeUndefined();
    expect(result.metrics.cloudUpload).toBe(false);
    expect(result.status === 'COMPLETED' || result.status === 'NEEDS_REVIEW').toBe(true);
  });

  it('runs remaining LOG workflows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-log-more-'));
    const ships = join(dir, 'ships.xlsx');
    writeSheet(ships, [
      ['运单号', '承运商', '发货日期', '状态', '预计到达'],
      ['T1', '顺丰', '2026-07-01', '在途', '2026-07-10'],
    ]);
    const shipResult = await createWorkflowRuntime().execute({
      workflowId: 'LOG-SHIPMENT-TRACK-003',
      inputFiles: [{ role: 'shipments', path: ships }],
      outputDir: join(dir, 'out-ship'),
      runDate: '2026-07-22',
    });
    expect(shipResult.errorMessage).toBeUndefined();
    expect(shipResult.metrics.cloudUpload).toBe(false);

    const tr = join(dir, 'tr.xlsx');
    writeSheet(tr, [
      ['调拨单号', '调出仓', '调入仓', 'SKU', '数量', '状态', '发运日期'],
      ['TR1', 'WH1', 'WH2', 'A1', 3, '在途', '2026-07-01'],
    ]);
    const trResult = await createWorkflowRuntime().execute({
      workflowId: 'LOG-TRANSFER-CLEAN-005',
      inputFiles: [{ role: 'transfers', path: tr }],
      outputDir: join(dir, 'out-tr'),
      runDate: '2026-07-22',
    });
    expect(trResult.errorMessage).toBeUndefined();
    expect(trResult.metrics.cloudUpload).toBe(false);

    const inn = join(dir, 'in.xlsx');
    const out = join(dir, 'out.xlsx');
    writeSheet(inn, [
      ['单号', 'SKU', '仓库', '数量', '单据日期'],
      ['I1', 'A1', 'WH1', 5, '2026-07-20'],
    ]);
    writeSheet(out, [
      ['单号', 'SKU', '仓库', '数量', '单据日期'],
      ['O1', 'A1', 'WH1', 2, '2026-07-21'],
    ]);
    const io = await createWorkflowRuntime().execute({
      workflowId: 'LOG-INOUT-RECONCILE-002',
      inputFiles: [
        { role: 'inbound', path: inn },
        { role: 'outbound', path: out },
      ],
      outputDir: join(dir, 'out-io'),
      runDate: '2026-07-22',
    });
    expect(io.errorMessage).toBeUndefined();
    expect(io.metrics.cloudUpload).toBe(false);
  });
});
