/** Server-side upload whitelist (includes leading dot). */
export const ALLOWED_UPLOAD_EXTENSIONS = [
  '.xlsx',
  '.xls',
  '.csv',
  '.doc',
  '.docx',
  '.pdf',
  '.ppt',
  '.pptx',
  '.txt',
  '.rtf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
] as const;

export type AllowedUploadExtension = (typeof ALLOWED_UPLOAD_EXTENSIONS)[number];

export const EXCEL_UPLOAD_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;

export const IMAGE_UPLOAD_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;

const EXTENSION_SET = new Set<string>(ALLOWED_UPLOAD_EXTENSIONS);

export function normalizeUploadExtension(filenameOrExt: string): string {
  const raw = filenameOrExt.trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('.')) return raw;
  const dot = raw.lastIndexOf('.');
  if (dot >= 0) return raw.slice(dot);
  return `.${raw}`;
}

export function isAllowedUploadExtension(filenameOrExt: string): boolean {
  return EXTENSION_SET.has(normalizeUploadExtension(filenameOrExt));
}

export function isImageUploadExtension(filenameOrExt: string): boolean {
  const ext = normalizeUploadExtension(filenameOrExt);
  return (IMAGE_UPLOAD_EXTENSIONS as readonly string[]).includes(ext);
}

export function isExcelUploadExtension(filenameOrExt: string): boolean {
  const ext = normalizeUploadExtension(filenameOrExt);
  return (EXCEL_UPLOAD_EXTENSIONS as readonly string[]).includes(ext);
}

/** Value for HTML `<input accept="...">`. */
export function getUploadAcceptAttribute(): string {
  return ALLOWED_UPLOAD_EXTENSIONS.join(',');
}

export function formatAllowedUploadTypesLabel(): string {
  return 'pdf、word、excel、图片、txt、ppt、rtf';
}

export const ALLOWED_UPLOAD_TYPES_MESSAGE = `仅支持 ${formatAllowedUploadTypesLabel()} 文件`;

export const IMAGE_UPLOAD_TYPES_MESSAGE = '仅支持 png、jpg、jpeg、webp 图片';

/** 模板中心 / 智能体任务统一支持的文件扩展名（与上传白名单一致） */
export const TEMPLATE_FILE_EXTENSIONS = ALLOWED_UPLOAD_EXTENSIONS;

export const TEMPLATE_FILE_TYPE_TAGS = [
  'pdf',
  'word',
  'excel',
  '图片',
  'txt',
  'ppt',
  'rtf',
] as const;

export function getTemplateAcceptAttribute(): string {
  return TEMPLATE_FILE_EXTENSIONS.join(',');
}

export function isTemplateSupportedFile(filename: string): boolean {
  return isAllowedUploadExtension(filename);
}

export function formatTemplateFileTypesLabel(): string {
  return TEMPLATE_FILE_TYPE_TAGS.join('、');
}

export function templateFileTypesForDisplay(): string[] {
  return [...TEMPLATE_FILE_TYPE_TAGS];
}
