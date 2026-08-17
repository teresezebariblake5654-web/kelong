import { randomUUID } from 'crypto';

export function generateId(): string {
  return randomUUID();
}

export function generateStoredFilename(originalName: string): string {
  const ext = originalName.includes('.') ? originalName.slice(originalName.lastIndexOf('.')) : '';
  return `${Date.now()}-${randomUUID()}${ext}`;
}
