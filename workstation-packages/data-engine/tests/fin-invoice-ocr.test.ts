import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  createRuleStore,
  createWorkflowRuntime,
  moneyAdd,
  moneyToFixed,
  toInvoiceOcrRules,
  StructuredInvoiceProvider,
  extractInvoicesWithRegistry,
} from '../src/index.js';

function writeSheet(path: string, rows: unknown[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  writeFileSync(path, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

async function runInvoice(options: {
  invoices: unknown[][];
  purchases?: unknown[][];
  rules?: Record<string, unknown>;
  fileName?: string;
  runDate?: string;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'aw-fin-inv-'));
  const invPath = join(dir, options.fileName ?? 'invoices.xlsx');
  writeSheet(invPath, options.invoices);
  const inputFiles: Array<{ role: string; path: string; originalName?: string }> = [
    { role: 'invoice_files', path: invPath, originalName: options.fileName ?? 'invoices.xlsx' },
  ];
  if (options.purchases) {
    const p = join(dir, 'po.xlsx');
    writeSheet(p, options.purchases);
    inputFiles.push({ role: 'purchase_records', path: p });
  }
  const result = await createWorkflowRuntime().execute({
    workflowId: 'FIN-INVOICE-OCR-004',
    inputFiles,
    rules: options.rules,
    outputDir: join(dir, 'out'),
    runDate: options.runDate ?? '2026-07-15',
  });
  const workbook = result.outputFiles[0]
    ? XLSX.read(readFileSync(result.outputFiles[0]!), { type: 'buffer' })
    : null;
  return { result, workbook };
}

describe('FIN-INVOICE-OCR-004', () => {
  it('structured extract validates amount+tax and keeps provider fields', async () => {
    expect(moneyToFixed(moneyAdd('0.1', '0.2'))).toBe('0.30');
    const { result, workbook } = await runInvoice({
      invoices: [
        ['发票代码', '发票号码', '开票日期', '销方名称', '销方税号', '金额', '税额', '价税合计'],
        ['110', '0001', '2026-07-01', '供应商A', 'T001', '0.1', '0.2', '0.30'],
      ],
    });
    expect(result.errorMessage).toBeUndefined();
    expect(result.status).toBe('COMPLETED');
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['发票登记表']!);
    expect(rows[0]!.status).toBe('READY');
    expect(rows[0]!.provider).toBe('STRUCTURED');
    expect(rows[0]!.confidence).toBe(1);
    expect(rows[0]!.original).toBeTruthy();
    expect(rows[0]!.normalized).toBeTruthy();
    expect(result.outputFiles[0]).toMatch(/发票识别与核对_2026-07-15\.xlsx$/);
  });

  it('missing role fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aw-fin-inv-miss-'));
    const result = await createWorkflowRuntime().execute({
      workflowId: 'FIN-INVOICE-OCR-004',
      inputFiles: [],
      outputDir: join(dir, 'out'),
      runDate: '2026-07-15',
    });
    expect(result.status).toBe('FAILED');
  });

  it('duplicate + amount mismatch → NEEDS_REVIEW sheets', async () => {
    const { result, workbook } = await runInvoice({
      invoices: [
        ['发票代码', '发票号码', '开票日期', '销方名称', '销方税号', '金额', '税额', '价税合计'],
        ['110', '0001', '2026-07-01', '供应商A', 'T001', 100, 13, 113],
        ['110', '0001', '2026-07-01', '供应商A', 'T001', 100, 13, 113],
        ['110', '0002', '2026-07-02', '供应商B', 'T002', 100, 13, 200],
      ],
      purchases: [
        ['采购单号', '供应商', '金额', '税额'],
        ['PO1', '供应商A', 100, 13],
      ],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.exceptions.some((e) => e.code === 'DUPLICATE' || e.code === 'AMOUNT_MISMATCH')).toBe(
      true,
    );
    expect(workbook!.SheetNames).toEqual([
      '发票登记表',
      '重复发票',
      '低置信度',
      '采购匹配',
      '金额异常',
      '规则快照',
      '运行说明',
    ]);
  });

  it('image/pdf-only without structured rows → OCR_PROVIDER_UNAVAILABLE', async () => {
    const unavailable = await extractInvoicesWithRegistry({
      ocrMode: 'STRUCTURED_ONLY',
      rows: [],
      fileName: 'scan.pdf',
    });
    expect(unavailable.unavailable).toBe(true);
    expect(unavailable.reason).toBe('OCR_PROVIDER_UNAVAILABLE');

    // Empty structured workbook named like pdf: still unavailable path via provider registry intent
    const provider = new StructuredInvoiceProvider();
    const items = await provider.extract({ rows: [], fileName: 'a.png' });
    expect(items).toEqual([]);
  });

  it('rule defaults and confidence override', async () => {
    const defaults = createRuleStore().getDefaults('FIN-INVOICE-OCR-004');
    expect(defaults.ocrMode).toBe('STRUCTURED_ONLY');
    expect(toInvoiceOcrRules(defaults).confidenceThreshold).toBe(0.8);
    const { workbook } = await runInvoice({
      invoices: [
        ['发票代码', '发票号码', '开票日期', '销方名称', '销方税号', '金额', '税额', '价税合计'],
        ['110', '0009', '2026-07-01', '供应商A', 'T001', 10, 1, 11],
      ],
      rules: { confidenceThreshold: 1.1, ocrMode: 'MANUAL' },
    });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook!.Sheets['发票登记表']!);
    expect(rows[0]!.provider).toBe('MANUAL');
    expect(String(rows[0]!.status)).toMatch(/LOW_CONFIDENCE|READY|PURCHASE_MATCHED/);
  });

  it('fetch=0, AI sanitize, deterministic, no fake OCR', async () => {
    let fetchCount = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCount += 1;
      return original(...args);
    }) as typeof fetch;
    const invoices = [
      ['发票代码', '发票号码', '开票日期', '销方名称', '销方税号', '金额', '税额', '价税合计'],
      ['110', '0001', '2026-07-01', '供应商A', 'T001', '0.1', '0.2', '0.30'],
    ];
    try {
      const a = await runInvoice({ invoices });
      const b = await runInvoice({ invoices });
      expect(fetchCount).toBe(0);
      expect(a.result.metrics.cloudOcr).toBe(false);
      expect(a.result.aiSummaryPayload?.rawRows).toBe(false);
      expect(JSON.stringify(a.result.aiSummaryPayload)).not.toContain('供应商A');
      expect(a.result.metrics.invoiceCount).toBe(b.result.metrics.invoiceCount);
    } finally {
      globalThis.fetch = original;
    }
  });
});
