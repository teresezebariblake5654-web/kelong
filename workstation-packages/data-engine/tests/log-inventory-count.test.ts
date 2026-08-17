import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createRuleStore,
  createWorkflowRuntime,
  qtyDiff,
  toLogInventoryRules,
  sanitizeLogSummary,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

describe('LOG-INVENTORY-COUNT-001', () => {
  it('flags shortage/overage, never auto-adjusts stock', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-log-inv-'));
    const ledger = join(dir, 'ledger.xlsx');
    const count = join(dir, 'count.xlsx');
    writeSheet(ledger, [
      ['SKU', '仓库', '账面库存', '截止日期'],
      ['S1', 'WH1', 100, '2026-07-20'],
      ['S2', 'WH1', 50, '2026-07-20'],
    ]);
    writeSheet(count, [
      ['SKU', '仓库', '实盘数量', '盘点日期'],
      ['S1', 'WH1', 90, '2026-07-21'],
      ['S2', 'WH1', 55, '2026-07-21'],
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
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.metrics.cloudUpload).toBe(false);
    expect(result.metrics.autoAdjustStock).toBe(false);
    expect(result.outputFiles[0]).toMatch(/库存盘点结果_2026-07-22\.xlsx$/);

    const wb = XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' });
    expect(wb.SheetNames).toEqual(
      expect.arrayContaining(['盘点总表', '盘亏', '盘盈', '差异明细', '运行说明']),
    );
    expect(result.aiSummaryPayload?.rawRows).toBe(false);
  });

  it('matched within tolerance → COMPLETED', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-log-inv-ok-'));
    const ledger = join(dir, 'ledger.xlsx');
    const count = join(dir, 'count.xlsx');
    writeSheet(ledger, [
      ['SKU', '仓库', '账面库存', '截止日期'],
      ['S1', 'WH1', 10, '2026-07-20'],
    ]);
    writeSheet(count, [
      ['SKU', '仓库', '实盘数量', '盘点日期'],
      ['S1', 'WH1', 10, '2026-07-21'],
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
    expect(result.status).toBe('COMPLETED');
    expect(result.metrics.shortageCount).toBe(0);
  });

  it('missing role fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-log-inv-miss-'));
    const result = await createWorkflowRuntime().execute({
      workflowId: 'LOG-INVENTORY-COUNT-001',
      inputFiles: [],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-22',
    });
    expect(result.status).toBe('FAILED');
  });

  it('rules defaults and helpers', () => {
    const rules = toLogInventoryRules(createRuleStore().getDefaults('LOG-INVENTORY-COUNT-001'));
    expect(rules.matchRule).toBe('SKU_WAREHOUSE');
    expect(rules.qtyTolerance).toBe('0');
    expect(qtyDiff(90, 100)).toBe(-10);
    expect(sanitizeLogSummary({ rawRows: true }).rawRows).toBe(false);
  });
});
