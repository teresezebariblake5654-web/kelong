import { describe, expect, it } from 'vitest';
import {
  maskBankAccount,
  maskCounterparty,
  maskDocumentNo,
  maskEmployeeName,
  maskIdNumber,
  maskInvoiceNo,
  maskPhone,
  maskTaxId,
  maskedSampleForField,
  sanitizeFinancialError,
  sanitizeWorkflowError,
} from './sensitiveData';

describe('sensitiveData', () => {
  it('masks phone / id / bank / name / finance fields', () => {
    expect(maskPhone('13800138000')).toBe('138****8000');
    expect(maskIdNumber('110101199001011234')).toMatch(/^110\*+1234$/);
    expect(maskBankAccount('6222021234567890123')).toMatch(/\d{4}$/);
    expect(maskEmployeeName('张三丰')).toBe('张*丰');
    expect(maskInvoiceNo('12345678')).toMatch(/\*{4}/);
    expect(maskTaxId('91310000MA1FL1XXXX')).toMatch(/\*/);
    expect(maskCounterparty('上海某某科技有限公司')).toMatch(/\*/);
    expect(maskDocumentNo('AR20260715001')).toMatch(/\*/);
  });

  it('sanitizes error messages and field samples', () => {
    expect(sanitizeWorkflowError('fail 13800138000 path C:\\Users\\a\\b.xlsx')).toContain(
      '[手机号已隐藏]',
    );
    expect(sanitizeWorkflowError('fail 13800138000 path C:\\Users\\a\\b.xlsx')).toContain(
      '[本地路径已隐藏]',
    );
    expect(sanitizeFinancialError('bank 6222021234567890123')).toContain('[银行卡已隐藏]');
    expect(maskedSampleForField('phone')).toContain('*');
    expect(maskedSampleForField('baseSalary')).toBe('***.**');
    expect(maskedSampleForField('invoiceNo')).toContain('*');
    expect(maskedSampleForField('counterparty')).toContain('*');
  });
});
