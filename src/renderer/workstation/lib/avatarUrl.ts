import { loadSettings } from './localStore';

/** Resolve stored avatar path to a browser-loadable URL. */
export function resolveAvatarDisplayUrl(avatarUrl?: string | null): string | null {
  const raw = avatarUrl?.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
  const base = loadSettings().apiBaseUrl.replace(/\/$/, '');
  if (raw.startsWith('/')) return `${base}${raw}`;
  return `${base}/${raw}`;
}
