import type { DataRow } from '../../types.js';
import { asText } from '../operators/fieldUtils.js';
import { normalizeMoney, moneyAdd, moneyToFixed } from '../operators/financeCommon.js';
import { normalizeDate } from '../operators/normalizeDate.js';

export type InvoiceOcrFieldSet = {
  invoiceCode: string;
  invoiceNo: string;
  invoiceDate: string;
  sellerName: string;
  sellerTaxId: string;
  buyerName: string;
  buyerTaxId: string;
  amount: string;
  taxAmount: string;
  totalAmount: string;
};

export type InvoiceOcrExtracted = InvoiceOcrFieldSet & {
  confidence: number;
  provider: string;
  statusHint?: string;
  original: Partial<InvoiceOcrFieldSet>;
  normalized: InvoiceOcrFieldSet;
  sourceTrace?: string;
  rowIndex?: number;
};

/**
 * Local-only invoice extraction. No cloud OCR; image/PDF pixels are never decoded.
 */
export interface InvoiceOcrProvider {
  name: string;
  extract(input: {
    rows?: DataRow[];
    fileName?: string;
  }): Promise<InvoiceOcrExtracted[]>;
}

function pick(row: DataRow, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return '';
}

function normalizeFieldSet(raw: Partial<InvoiceOcrFieldSet>): InvoiceOcrFieldSet {
  const amount = normalizeMoney(raw.amount);
  const tax = normalizeMoney(raw.taxAmount);
  const total = normalizeMoney(raw.totalAmount);
  const date = normalizeDate(raw.invoiceDate);
  let totalFixed = total.ok ? moneyToFixed(total.value) : '';
  if (!total.ok && amount.ok && tax.ok) {
    totalFixed = moneyToFixed(moneyAdd(amount.value, tax.value));
  }
  return {
    invoiceCode: asText(raw.invoiceCode),
    invoiceNo: asText(raw.invoiceNo),
    invoiceDate: date.ok ? date.value : asText(raw.invoiceDate),
    sellerName: asText(raw.sellerName),
    sellerTaxId: asText(raw.sellerTaxId),
    buyerName: asText(raw.buyerName),
    buyerTaxId: asText(raw.buyerTaxId),
    amount: amount.ok ? moneyToFixed(amount.value) : asText(raw.amount),
    taxAmount: tax.ok ? moneyToFixed(tax.value) : asText(raw.taxAmount),
    totalAmount: totalFixed || asText(raw.totalAmount),
  };
}

function looksLikeImageOrPdf(fileName?: string): boolean {
  const name = (fileName ?? '').toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|pdf)$/.test(name);
}

function rowHasInvoiceFields(row: DataRow): boolean {
  return Boolean(
    asText(pick(row, ['invoiceNo', '发票号码', '发票号', 'invoice_no'])) ||
      asText(pick(row, ['invoiceCode', '发票代码', 'invoice_code'])) ||
      asText(pick(row, ['totalAmount', '价税合计', '合计', 'total_amount'])),
  );
}

/** Reads structured Excel/CSV invoice rows only — never inspects image pixels. */
export class StructuredInvoiceProvider implements InvoiceOcrProvider {
  name = 'STRUCTURED';

  async extract(input: { rows?: DataRow[]; fileName?: string }): Promise<InvoiceOcrExtracted[]> {
    const rows = input.rows ?? [];
    const structured = rows.filter(rowHasInvoiceFields);
    if (structured.length === 0) {
      if (looksLikeImageOrPdf(input.fileName)) return [];
      return [];
    }
    return structured.map((row, index) => {
      const original: Partial<InvoiceOcrFieldSet> = {
        invoiceCode: asText(pick(row, ['invoiceCode', '发票代码', 'invoice_code'])),
        invoiceNo: asText(pick(row, ['invoiceNo', '发票号码', '发票号', 'invoice_no'])),
        invoiceDate: asText(pick(row, ['invoiceDate', '开票日期', '发票日期', 'invoice_date'])),
        sellerName: asText(pick(row, ['sellerName', '销方名称', '销售方', 'seller_name'])),
        sellerTaxId: asText(pick(row, ['sellerTaxId', '销方税号', '销售方税号', 'seller_tax_id'])),
        buyerName: asText(pick(row, ['buyerName', '购方名称', '购买方', 'buyer_name'])),
        buyerTaxId: asText(pick(row, ['buyerTaxId', '购方税号', '购买方税号', 'buyer_tax_id'])),
        amount: asText(pick(row, ['amount', '金额', '不含税金额', 'net_amount'])),
        taxAmount: asText(pick(row, ['taxAmount', '税额', 'tax', 'tax_amount'])),
        totalAmount: asText(pick(row, ['totalAmount', '价税合计', '合计', 'total_amount'])),
      };
      const normalized = normalizeFieldSet(original);
      return {
        ...normalized,
        confidence: 1,
        provider: this.name,
        original,
        normalized,
        sourceTrace: `${asText(row._sourceFile)}#${asText(row._sourceSheet)}:${asText(row._sourceRow)}`,
        rowIndex: index,
      };
    });
  }
}

/** Marks rows as needing manual entry — no OCR pretend. */
export class ManualInvoiceProvider implements InvoiceOcrProvider {
  name = 'MANUAL';

  async extract(input: { rows?: DataRow[]; fileName?: string }): Promise<InvoiceOcrExtracted[]> {
    const rows = input.rows ?? [];
    if (rows.length === 0) {
      return [
        {
          invoiceCode: '',
          invoiceNo: '',
          invoiceDate: '',
          sellerName: '',
          sellerTaxId: '',
          buyerName: '',
          buyerTaxId: '',
          amount: '',
          taxAmount: '',
          totalAmount: '',
          confidence: 0,
          provider: this.name,
          statusHint: 'NEEDS_MANUAL',
          original: {},
          normalized: normalizeFieldSet({}),
          sourceTrace: input.fileName ?? '',
        },
      ];
    }
    const structured = new StructuredInvoiceProvider();
    const extracted = await structured.extract(input);
    return extracted.map((item) => ({
      ...item,
      confidence: Math.min(item.confidence, 0.5),
      provider: this.name,
      statusHint: 'NEEDS_MANUAL',
    }));
  }
}

export type InvoiceOcrMode = 'STRUCTURED_ONLY' | 'MANUAL' | string;

export function resolveInvoiceOcrProvider(ocrMode: InvoiceOcrMode): InvoiceOcrProvider {
  const mode = String(ocrMode || 'STRUCTURED_ONLY').toUpperCase();
  if (mode === 'MANUAL') return new ManualInvoiceProvider();
  return new StructuredInvoiceProvider();
}

export type InvoiceOcrRegistryResult = {
  provider: InvoiceOcrProvider;
  items: InvoiceOcrExtracted[];
  unavailable: boolean;
  reason?: string;
};

/**
 * Registry: STRUCTURED_ONLY / MANUAL. Image/PDF-only inputs without structured rows
 * yield OCR_PROVIDER_UNAVAILABLE (no fake pixel OCR).
 */
export async function extractInvoicesWithRegistry(input: {
  ocrMode: InvoiceOcrMode;
  rows?: DataRow[];
  fileName?: string;
}): Promise<InvoiceOcrRegistryResult> {
  const provider = resolveInvoiceOcrProvider(input.ocrMode);
  const rows = input.rows ?? [];
  const hasStructured = rows.some(rowHasInvoiceFields);
  if (!hasStructured && looksLikeImageOrPdf(input.fileName)) {
    return {
      provider,
      items: [],
      unavailable: true,
      reason: 'OCR_PROVIDER_UNAVAILABLE',
    };
  }
  if (!hasStructured && rows.length === 0 && looksLikeImageOrPdf(input.fileName)) {
    return {
      provider,
      items: [],
      unavailable: true,
      reason: 'OCR_PROVIDER_UNAVAILABLE',
    };
  }
  const items = await provider.extract({ rows, fileName: input.fileName });
  if (!hasStructured && items.length === 0 && String(input.ocrMode).toUpperCase() === 'STRUCTURED_ONLY') {
    return {
      provider,
      items: [],
      unavailable: true,
      reason: 'OCR_PROVIDER_UNAVAILABLE',
    };
  }
  return { provider, items, unavailable: false };
}
