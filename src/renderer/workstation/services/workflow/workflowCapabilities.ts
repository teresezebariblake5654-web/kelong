import { getFileExtension } from './pathSafety';

export type WorkflowCapabilityCode =
  | 'OK'
  | 'OCR_PROVIDER_UNAVAILABLE'
  | 'UNSUPPORTED_FORMAT'
  | 'STRUCTURED_ONLY';

export type WorkflowInputCapability = {
  ok: boolean;
  code: WorkflowCapabilityCode;
  message: string;
  /** Local providers that can run without cloud OCR. */
  availableProviders: string[];
};

const SPREADSHEET_EXT = new Set(['xlsx', 'xls', 'csv']);
const IMAGE_PDF_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'pdf']);

/** Local invoice providers only — Structured / Manual. Never fake image OCR. */
export const LOCAL_INVOICE_OCR_PROVIDERS = [
  'StructuredInvoiceProvider',
  'ManualInvoiceOcrProvider',
] as const;

export function isImageOrPdfExtension(ext: string): boolean {
  return IMAGE_PDF_EXT.has(ext.toLowerCase().replace(/^\./, ''));
}

export function isSpreadsheetExtension(ext: string): boolean {
  return SPREADSHEET_EXT.has(ext.toLowerCase().replace(/^\./, ''));
}

export function allowedExtensionsForRole(workflowId: string, role: string): string[] {
  if (workflowId === 'FIN-INVOICE-OCR-004' && role === 'invoice_files') {
    return ['xlsx', 'xls', 'csv', 'png', 'jpg', 'jpeg', 'pdf'];
  }
  return ['xlsx', 'xls', 'csv'];
}

/**
 * Pre-run capability check for workflow inputs.
 * Image/PDF invoice inputs without a real OCR provider → OCR_PROVIDER_UNAVAILABLE.
 */
export function checkWorkflowInputCapability(input: {
  workflowId: string;
  role: string;
  fileName: string;
  extension?: string;
}): WorkflowInputCapability {
  const ext = (input.extension || getFileExtension(input.fileName)).toLowerCase().replace(/^\./, '');
  const allowed = allowedExtensionsForRole(input.workflowId, input.role);

  if (!ext || !allowed.includes(ext)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_FORMAT',
      message: `不支持的文件格式：.${ext || '未知'}`,
      availableProviders: [...LOCAL_INVOICE_OCR_PROVIDERS],
    };
  }

  if (input.workflowId === 'FIN-INVOICE-OCR-004' && input.role === 'invoice_files') {
    if (isImageOrPdfExtension(ext)) {
      return {
        ok: false,
        code: 'OCR_PROVIDER_UNAVAILABLE',
        message:
          '未安装本地 OCR，无法识别图片/PDF。请改用结构化 Excel/CSV，或切换人工录入 Provider。',
        availableProviders: [...LOCAL_INVOICE_OCR_PROVIDERS],
      };
    }
    return {
      ok: true,
      code: 'STRUCTURED_ONLY',
      message: '将使用 StructuredInvoiceProvider / ManualInvoiceOcrProvider（无云端 OCR）',
      availableProviders: [...LOCAL_INVOICE_OCR_PROVIDERS],
    };
  }

  if (!isSpreadsheetExtension(ext)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_FORMAT',
      message: `请使用 xlsx/xls/csv：.${ext}`,
      availableProviders: [],
    };
  }

  return {
    ok: true,
    code: 'OK',
    message: '输入能力检查通过',
    availableProviders: [],
  };
}
