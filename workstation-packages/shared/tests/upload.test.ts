import { describe, expect, it } from 'vitest';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  getUploadAcceptAttribute,
  isAllowedUploadExtension,
  isExcelUploadExtension,
  isImageUploadExtension,
} from '../src/upload.js';

describe('upload constants', () => {
  it('includes pdf word excel image txt ppt rtf', () => {
    for (const ext of [
      '.pdf',
      '.doc',
      '.docx',
      '.xlsx',
      '.xls',
      '.csv',
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.txt',
      '.ppt',
      '.pptx',
      '.rtf',
    ]) {
      expect(isAllowedUploadExtension(ext)).toBe(true);
    }
  });

  it('rejects unsupported extensions', () => {
    expect(isAllowedUploadExtension('.exe')).toBe(false);
    expect(isAllowedUploadExtension('.zip')).toBe(false);
  });

  it('classifies excel and image subsets', () => {
    expect(isExcelUploadExtension('report.xlsx')).toBe(true);
    expect(isImageUploadExtension('photo.png')).toBe(true);
    expect(isImageUploadExtension('doc.pdf')).toBe(false);
  });

  it('builds accept attribute from whitelist', () => {
    expect(getUploadAcceptAttribute()).toBe(ALLOWED_UPLOAD_EXTENSIONS.join(','));
  });
});
