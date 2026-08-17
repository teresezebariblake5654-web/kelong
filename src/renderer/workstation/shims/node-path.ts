/** Minimal path helpers for browser Vite bundle. */

export function basename(filePath: string, ext?: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const name = normalized.split('/').pop() || filePath;
  if (ext && name.endsWith(ext)) return name.slice(0, -ext.length);
  return name;
}

export function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx <= 0 ? '.' : normalized.slice(0, idx);
}

export function join(...parts: string[]): string {
  const combined = parts
    .filter(Boolean)
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');
  return combined;
}

export function resolve(...parts: string[]): string {
  return join(...parts);
}

export function normalize(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  const prefix = filePath.startsWith('/') ? '/' : '';
  return prefix + stack.join('/');
}

export default { basename, dirname, join, resolve, normalize };
