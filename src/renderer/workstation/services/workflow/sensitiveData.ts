import { asText } from './maskHelpers';

export function maskPhone(value: unknown): string {
  const text = asText(value).replace(/\s+/g, '');
  if (!text) return '';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

export function maskIdNumber(value: unknown): string {
  const text = asText(value).replace(/\s+/g, '');
  if (!text) return '';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 3)}${'*'.repeat(Math.max(text.length - 7, 4))}${text.slice(-4)}`;
}

export function maskBankAccount(value: unknown): string {
  const text = asText(value).replace(/\s+/g, '');
  if (!text) return '';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${'*'.repeat(Math.max(text.length - 4, 4))}${text.slice(-4)}`;
}

export function maskEmployeeName(value: unknown): string {
  const text = asText(value);
  if (!text) return '';
  if (text.length === 1) return '*';
  if (text.length === 2) return `${text[0]}*`;
  return `${text[0]}${'*'.repeat(text.length - 2)}${text[text.length - 1]}`;
}

export function maskInvoiceNo(value: unknown): string {
  const text = asText(value).replace(/\s+/g, '');
  if (!text) return '';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 2)}${'*'.repeat(Math.max(text.length - 4, 4))}${text.slice(-2)}`;
}

export function maskTaxId(value: unknown): string {
  const text = asText(value).replace(/\s+/g, '');
  if (!text) return '';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 4)}${'*'.repeat(Math.max(text.length - 8, 4))}${text.slice(-4)}`;
}

export function maskCounterparty(value: unknown): string {
  const text = asText(value);
  if (!text) return '';
  if (text.length <= 2) return '*'.repeat(text.length);
  if (text.length <= 4) return `${text[0]}${'*'.repeat(text.length - 2)}${text[text.length - 1]}`;
  return `${text.slice(0, 2)}${'*'.repeat(text.length - 4)}${text.slice(-2)}`;
}

export function maskDocumentNo(value: unknown): string {
  const text = asText(value).replace(/\s+/g, '');
  if (!text) return '';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 2)}${'*'.repeat(Math.max(text.length - 4, 4))}${text.slice(-2)}`;
}

const SENSITIVE_PATTERNS: Array<{ re: RegExp; replace: string }> = [
  { re: /\b\d{16,19}\b/g, replace: '[银行卡已隐藏]' },
  { re: /\b[1-9]\d{5}(?:19|20)\d{9}[\dXx]\b/g, replace: '[身份证已隐藏]' },
  { re: /\b1[3-9]\d{9}\b/g, replace: '[手机号已隐藏]' },
  { re: /[A-Z]:\\[^\s"']+/gi, replace: '[本地路径已隐藏]' },
  { re: /\/(?:Users|home|var)\/[^\s"']+/g, replace: '[本地路径已隐藏]' },
];

export function sanitizeWorkflowError(message: unknown): string {
  let text = asText(message) || '发生未知错误';
  for (const { re, replace } of SENSITIVE_PATTERNS) {
    text = text.replace(re, replace);
  }
  // Drop long stack-like lines from user-facing message
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? text;
  return firstLine.slice(0, 240);
}

/** Finance-facing error sanitizer (same local-only policy). */
export function sanitizeFinancialError(message: unknown): string {
  return sanitizeWorkflowError(message);
}

export function looksLikeSensitiveField(fieldName: string): boolean {
  const key = fieldName.toLowerCase();
  return (
    key.includes('phone') ||
    key.includes('mobile') ||
    key.includes('idnumber') ||
    key.includes('id_no') ||
    key.includes('bank') ||
    key.includes('salary') ||
    key.includes('netpay') ||
    key.includes('employeename') ||
    key.includes('invoiceno') ||
    key.includes('taxid') ||
    key.includes('counterparty') ||
    key.includes('documentno') ||
    key.includes('seller') ||
    key.includes('buyer')
  );
}

export function maskedSampleForField(fieldName: string): string {
  const key = fieldName.toLowerCase();
  if (key.includes('phone') || key.includes('mobile')) return maskPhone('13800138000');
  if (key.includes('taxid') || key.includes('tax_id')) return maskTaxId('91310000MA1FL1XXXX');
  if (key.includes('invoiceno') || key.includes('invoice_no')) return maskInvoiceNo('12345678');
  if (key.includes('documentno') || key.includes('document_no')) return maskDocumentNo('AR20260715001');
  if (key.includes('counterparty') || key.includes('seller') || key.includes('buyer') || key.includes('vendor')) {
    return maskCounterparty('上海某某科技有限公司');
  }
  if (key.includes('bank')) return maskBankAccount('6222021234567890123');
  if (key.includes('id') && !key.includes('employeeid')) return maskIdNumber('110101199001011234');
  if (key.includes('name')) return maskEmployeeName('张三');
  if (key.includes('salary') || key.includes('pay') || key.includes('amount')) return '***.**';
  return '已识别';
}
