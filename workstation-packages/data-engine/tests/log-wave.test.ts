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

describe('Logistics wave e2e — all 5 workflows', () => {
  it('executes all logistics workflows, re-reads sheets, fetch=0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-log-wave-'));
    const out = join(dir, 'out');
    const runtime = createWorkflowRuntime();
    let fetchCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return original(...args);
    }) as typeof fetch;

    try {
      const ledger = join(dir, 'ledger.xlsx');
      const count = join(dir, 'count.xlsx');
      writeSheet(ledger, [
        ['SKU', '仓库', '账面库存', '截止日期'],
        ['S1', 'WH1', 100, '2026-07-20'],
      ]);
      writeSheet(count, [
        ['SKU', '仓库', '实盘数量', '盘点日期'],
        ['S1', 'WH1', 100, '2026-07-21'],
      ]);
      const invResult = await runtime.execute({
        workflowId: 'LOG-INVENTORY-COUNT-001',
        inputFiles: [
          { role: 'stock_ledger', path: ledger },
          { role: 'physical_count', path: count },
        ],
        outputDir: out,
        runDate: '2026-07-22',
      });

      const inbound = join(dir, 'inbound.xlsx');
      const outbound = join(dir, 'outbound.xlsx');
      writeSheet(inbound, [
        ['单据号', 'SKU', '仓库', '数量', '日期'],
        ['D1', 'S1', 'WH1', 10, '2026-07-10'],
      ]);
      writeSheet(outbound, [
        ['单据号', 'SKU', '仓库', '数量', '日期'],
        ['D1', 'S1', 'WH1', 10, '2026-07-10'],
      ]);
      const inoutResult = await runtime.execute({
        workflowId: 'LOG-INOUT-RECONCILE-002',
        inputFiles: [
          { role: 'inbound', path: inbound },
          { role: 'outbound', path: outbound },
        ],
        outputDir: out,
        runDate: '2026-07-22',
      });

      const ships = join(dir, 'ships.xlsx');
      writeSheet(ships, [
        ['运单号', '承运商', '发货日期', '状态', '预计到达'],
        ['T1', 'SF', '2026-07-20', '在途', '2026-07-25'],
      ]);
      const trackResult = await runtime.execute({
        workflowId: 'LOG-SHIPMENT-TRACK-003',
        inputFiles: [{ role: 'shipments', path: ships }],
        outputDir: out,
        runDate: '2026-07-22',
      });

      const stock = join(dir, 'stock.xlsx');
      writeSheet(stock, [
        ['SKU', '仓库', '库存', '安全库存'],
        ['S1', 'WH1', 100, 10],
      ]);
      const alertResult = await runtime.execute({
        workflowId: 'LOG-STOCK-ALERT-004',
        inputFiles: [{ role: 'inventory', path: stock }],
        outputDir: out,
        runDate: '2026-07-22',
      });

      const transfers = join(dir, 'transfers.xlsx');
      writeSheet(transfers, [
        ['调拨单号', '调出仓', '调入仓', 'SKU', '数量', '状态', '发运日期'],
        ['TR1', 'WH1', 'WH2', 'S1', 5, '待收货', '2026-07-20'],
      ]);
      const transferResult = await runtime.execute({
        workflowId: 'LOG-TRANSFER-CLEAN-005',
        inputFiles: [{ role: 'transfers', path: transfers }],
        outputDir: out,
        runDate: '2026-07-22',
      });

      for (const result of [invResult, inoutResult, trackResult, alertResult, transferResult]) {
        expect(result.errorMessage).toBeUndefined();
        expect(['COMPLETED', 'NEEDS_REVIEW']).toContain(result.status);
        expect(result.outputFiles[0]).toBeTruthy();
        expect(result.metrics.cloudUpload).toBe(false);
        const wb = XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' });
        expect(wb.SheetNames.length).toBeGreaterThan(3);
        expect(wb.SheetNames).toContain('运行说明');
      }

      expect(invResult.outputFiles[0]).toMatch(/库存盘点结果_/);
      expect(inoutResult.outputFiles[0]).toMatch(/出入库核对_/);
      expect(trackResult.outputFiles[0]).toMatch(/运单追踪_/);
      expect(alertResult.outputFiles[0]).toMatch(/库存预警_/);
      expect(transferResult.outputFiles[0]).toMatch(/调拨整理_/);
      expect(invResult.metrics.autoAdjustStock).toBe(false);
      expect(trackResult.metrics.autoShip).toBe(false);
      expect(transferResult.metrics.autoCompleteTransfer).toBe(false);
      expect(fetchCount).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
