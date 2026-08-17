const TRAVERSAL = /(^|[\\/])\.\.([\\/]|$)/;

export function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

export function assertNoPathTraversal(path: string): void {
  const normalized = normalizePathSeparators(path);
  if (TRAVERSAL.test(normalized) || normalized.includes('\0')) {
    throw new Error('非法路径：禁止使用 ../ 或空字节');
  }
}

export function isPathInsideWorkspace(filePath: string, workspaceRoot: string): boolean {
  const file = normalizePathSeparators(filePath).toLowerCase();
  const root = normalizePathSeparators(workspaceRoot).toLowerCase().replace(/\/+$/, '');
  if (file.startsWith('memory://')) return true;
  if (!root) return false;
  return file === root || file.startsWith(`${root}/`);
}

export function assertPathInsideWorkspace(filePath: string, workspaceRoot: string): void {
  assertNoPathTraversal(filePath);
  if (filePath.startsWith('memory://')) return;
  if (!isPathInsideWorkspace(filePath, workspaceRoot)) {
    throw new Error('目标路径不在当前工作区内');
  }
}

export function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : '';
}

export function isAllowedSpreadsheetExtension(ext: string): boolean {
  return ['xlsx', 'xls', 'csv'].includes(ext.toLowerCase());
}

/** Spreadsheet + local invoice image/PDF selection (OCR capability gated separately). */
export function isAllowedWorkflowInputExtension(ext: string): boolean {
  const normalized = ext.toLowerCase().replace(/^\./, '');
  return (
    isAllowedSpreadsheetExtension(normalized) ||
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'pdf'].includes(normalized)
  );
}

export function displayFileName(pathOrName: string): string {
  const normalized = normalizePathSeparators(pathOrName);
  if (normalized.startsWith('memory://')) return normalized.slice('memory://'.length);
  const parts = normalized.split('/');
  return parts[parts.length - 1] || pathOrName;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export function shortSha256(sha: string): string {
  if (!sha) return '';
  return sha.length <= 16 ? sha : `${sha.slice(0, 8)}…${sha.slice(-6)}`;
}
