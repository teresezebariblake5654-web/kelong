/**
 * Electron-host stubs for @tauri-apps/* imports copied from the desktop client.
 * All APIs are no-ops so workstation UI can load without Tauri.
 */

export function isTauri(): boolean {
  return false;
}

export async function invoke<T = unknown>(_cmd: string, _args?: Record<string, unknown>): Promise<T> {
  throw new Error('Tauri invoke is unavailable in 火星 AI Electron host');
}

export async function getVersion(): Promise<string> {
  return 'electron-stub';
}

export async function getName(): Promise<string> {
  return '火星 AI';
}

export async function getTauriVersion(): Promise<string> {
  return '0.0.0-stub';
}

export async function save(_options?: unknown): Promise<string | null> {
  return null;
}

export async function open(_options?: unknown): Promise<string | string[] | null> {
  return null;
}

export async function writeFile(_path: string, _data: Uint8Array | string): Promise<void> {
  // no-op
}

export async function readFile(_path: string): Promise<Uint8Array> {
  return new Uint8Array();
}

export async function exists(_path: string): Promise<boolean> {
  return false;
}

export async function mkdir(_path: string, _options?: { recursive?: boolean }): Promise<void> {
  // no-op
}

export async function remove(_path: string): Promise<void> {
  // no-op
}

export async function readDir(_path: string): Promise<unknown[]> {
  return [];
}

export async function rename(_from: string, _to: string): Promise<void> {
  // no-op
}

export async function copyFile(_from: string, _to: string): Promise<void> {
  // no-op
}

export async function writeTextFile(_path: string, _contents: string): Promise<void> {
  // no-op
}

export async function readTextFile(_path: string): Promise<string> {
  return '';
}

export default {
  isTauri,
  invoke,
  getVersion,
  getName,
  getTauriVersion,
  save,
  open,
  writeFile,
  readFile,
  exists,
  mkdir,
  remove,
  readDir,
  rename,
  copyFile,
  writeTextFile,
  readTextFile,
};
