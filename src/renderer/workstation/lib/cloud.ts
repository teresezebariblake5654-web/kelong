import { createCloudClient } from '@aw/shared';
import { getLicenseToken, loadSettings } from './localStore';

export function getCloudClient() {
  const settings = loadSettings();
  return createCloudClient({
    baseUrl: settings.apiBaseUrl.replace(/\/$/, ''),
    getAccessToken: getLicenseToken,
  });
}

export function makeDeviceFingerprint(): string {
  const seed = [
    navigator.userAgent,
    navigator.language,
    String(screen.width),
    String(screen.height),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join('|');
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `device-${hash.toString(16)}`;
}

function fallbackUsbFingerprint(): string {
  const key = 'aw.desktop.usbFingerprint';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = `usb-${crypto.randomUUID()}`;
  localStorage.setItem(key, value);
  return value;
}

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Resolve Tauri invoke without importing @tauri-apps/api (breaks Vite browser preview). */
function getTauriInvoke(): TauriInvoke | null {
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: TauriInvoke } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };
  return w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke ?? null;
}

/**
 * Prefer Tauri native serial; fall back to localStorage in browser preview.
 */
export async function makeUsbFingerprint(): Promise<string> {
  try {
    const invoke = getTauriInvoke();
    if (invoke) {
      const serial = await invoke('get_usb_serial');
      if (typeof serial === 'string' && serial.trim()) {
        localStorage.setItem('aw.desktop.usbFingerprint', serial.trim());
        return serial.trim();
      }
    }
  } catch {
    // Browser / unsigned preview — use stable local id
  }
  return fallbackUsbFingerprint();
}
