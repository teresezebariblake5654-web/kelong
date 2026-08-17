#!/usr/bin/env node
/**
 * Production client packaging gate for Windows and/or macOS.
 *
 * Ensures API URLs are production, then runs the matching dist script.
 *
 * Usage (repo root):
 *   node scripts/ship-client-prod.cjs              # current OS default
 *   node scripts/ship-client-prod.cjs --platform win
 *   node scripts/ship-client-prod.cjs --platform mac
 *   node scripts/ship-client-prod.cjs --platform mac-arm64
 *   node scripts/ship-client-prod.cjs --platform mac-x64
 *   node scripts/ship-client-prod.cjs --platform all
 *
 * Optional env:
 *   WORKSTATION_API_BASE_URL / VITE_WORKSTATION_API_BASE_URL (default https://api.bx-aigc.com)
 */
const { spawnSync } = require('child_process');
const path = require('path');

const required = 'https://api.bx-aigc.com';
process.env.WORKSTATION_API_BASE_URL =
  (process.env.WORKSTATION_API_BASE_URL || required).replace(/\/$/, '');
process.env.VITE_WORKSTATION_API_BASE_URL =
  (process.env.VITE_WORKSTATION_API_BASE_URL || required).replace(/\/$/, '');
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const root = path.join(__dirname, '..');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function resolvePlatform() {
  const explicit = (argValue('--platform') || process.env.SHIP_PLATFORM || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (process.platform === 'darwin') return 'mac-arm64';
  if (process.platform === 'win32') return 'win';
  return 'win';
}

const PLATFORM_SCRIPTS = {
  win: 'dist:win',
  mac: 'dist:mac:arm64',
  'mac-arm64': 'dist:mac:arm64',
  'mac-x64': 'dist:mac:x64',
  all: null,
};

const platform = resolvePlatform();
if (!(platform in PLATFORM_SCRIPTS) && platform !== 'all') {
  console.error(
    `[ship-client-prod] Unknown platform "${platform}". Use: win | mac | mac-arm64 | mac-x64 | all`,
  );
  process.exit(1);
}

if ((platform === 'mac' || platform === 'mac-arm64' || platform === 'mac-x64' || platform === 'all') &&
  process.platform !== 'darwin' &&
  platform !== 'win') {
  if (platform === 'all' && process.platform === 'win32') {
    console.warn(
      '[ship-client-prod] macOS packages require a Mac. Building Windows only; run ship:mac:prod on a Mac for .dmg.',
    );
  } else if (platform !== 'all') {
    console.error(
      '[ship-client-prod] macOS packaging must run on macOS (electron-builder cannot produce signed .dmg on Windows).',
    );
    process.exit(1);
  }
}

const assert = spawnSync(
  process.execPath,
  [path.join(__dirname, 'assert-workstation-prod-api.cjs'), '--production'],
  { cwd: root, stdio: 'inherit', env: process.env },
);
if (assert.status !== 0) process.exit(assert.status || 1);

function runNpm(script) {
  console.log(`[ship-client-prod] Packaging (${script}) against`, process.env.VITE_WORKSTATION_API_BASE_URL);
  const dist = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });
  return dist.status || 0;
}

const targets =
  platform === 'all'
    ? process.platform === 'darwin'
      ? ['dist:win', 'dist:mac:arm64']
      : ['dist:win']
    : [PLATFORM_SCRIPTS[platform]];

for (const script of targets) {
  if (!script) continue;
  if (script.startsWith('dist:mac') && process.platform !== 'darwin') {
    console.error(`[ship-client-prod] Skipping ${script} — not on macOS.`);
    continue;
  }
  if (script === 'dist:win' && process.platform === 'darwin') {
    console.warn(
      '[ship-client-prod] Building Windows on macOS requires wine/cross tools; prefer ship:win:prod on a Windows machine.',
    );
  }
  const code = runNpm(script);
  if (code !== 0) process.exit(code);
}

console.log('[ship-client-prod] Done. Next: npm run publish:downloads -- --platform <win|mac-arm64|mac-x64|all>');
process.exit(0);
