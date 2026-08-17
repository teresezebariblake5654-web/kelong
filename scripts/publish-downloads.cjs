#!/usr/bin/env node
/**
 * Copy electron-builder artifacts into website/downloads with stable names
 * and refresh website/releases.json so the download page can offer Win + Mac.
 *
 * Usage:
 *   node scripts/publish-downloads.cjs --platform win
 *   node scripts/publish-downloads.cjs --platform mac-arm64
 *   node scripts/publish-downloads.cjs --platform mac-x64
 *   node scripts/publish-downloads.cjs --platform all
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const releaseDir = path.join(root, 'release');
const websiteDir = path.join(root, 'website');
const downloadsDir = path.join(websiteDir, 'downloads');
const releasesPath = path.join(websiteDir, 'releases.json');
const pkg = require(path.join(root, 'package.json'));

const STABLE = {
  win: {
    key: 'windows',
    file: 'WorkhorseAI-Windows-Setup.exe',
    match: (name) => /\.exe$/i.test(name) && /setup/i.test(name) && !/websetup/i.test(name),
  },
  'mac-arm64': {
    key: 'macArm64',
    file: 'WorkhorseAI-macOS-arm64.dmg',
    match: (name) => /\.dmg$/i.test(name) && /arm64|darwin-arm64/i.test(name),
  },
  'mac-x64': {
    key: 'macX64',
    file: 'WorkhorseAI-macOS-x64.dmg',
    match: (name) => /\.dmg$/i.test(name) && /(x64|amd64|darwin-x64)/i.test(name) && !/arm64/i.test(name),
  },
};

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function listReleaseFiles() {
  if (!fs.existsSync(releaseDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      out.push({ name: entry.name, full: path.join(releaseDir, entry.name) });
      continue;
    }
    if (!entry.isDirectory()) continue;
    const sub = path.join(releaseDir, entry.name);
    for (const nested of fs.readdirSync(sub)) {
      const full = path.join(sub, nested);
      if (fs.statSync(full).isFile()) out.push({ name: nested, full });
    }
  }
  return out;
}

function pickLatest(files, matcher) {
  const hits = files.filter((f) => matcher(f.name));
  if (!hits.length) return null;
  hits.sort((a, b) => fs.statSync(b.full).mtimeMs - fs.statSync(a.full).mtimeMs);
  return hits[0];
}

function loadReleases() {
  if (fs.existsSync(releasesPath)) {
    return JSON.parse(fs.readFileSync(releasesPath, 'utf8'));
  }
  return {
    version: pkg.version,
    updatedAt: '',
    windows: { label: 'Windows', url: './downloads/WorkhorseAI-Windows-Setup.exe', file: 'WorkhorseAI-Windows-Setup.exe', available: false },
    macArm64: { label: 'macOS Apple Silicon', url: './downloads/WorkhorseAI-macOS-arm64.dmg', file: 'WorkhorseAI-macOS-arm64.dmg', available: false },
    macX64: { label: 'macOS Intel', url: './downloads/WorkhorseAI-macOS-x64.dmg', file: 'WorkhorseAI-macOS-x64.dmg', available: false },
  };
}

const platformArg = (argValue('--platform') || 'all').trim().toLowerCase();
const platforms =
  platformArg === 'all'
    ? Object.keys(STABLE)
    : platformArg === 'mac'
      ? ['mac-arm64']
      : [platformArg];

for (const p of platforms) {
  if (!STABLE[p]) {
    console.error(`[publish-downloads] Unknown platform "${p}". Use win | mac-arm64 | mac-x64 | all`);
    process.exit(1);
  }
}

fs.mkdirSync(downloadsDir, { recursive: true });
const files = listReleaseFiles();
const releases = loadReleases();
const today = new Date().toISOString().slice(0, 10);
let copied = 0;

for (const p of platforms) {
  const spec = STABLE[p];
  const hit = pickLatest(files, spec.match);
  if (!hit) {
    console.warn(`[publish-downloads] No artifact found for ${p} under release/`);
    continue;
  }
  const dest = path.join(downloadsDir, spec.file);
  fs.copyFileSync(hit.full, dest);
  const entry = releases[spec.key] || {};
  entry.label = entry.label || spec.key;
  entry.file = spec.file;
  entry.url = `./downloads/${spec.file}`;
  entry.available = true;
  entry.source = hit.name;
  entry.sizeBytes = fs.statSync(dest).size;
  releases[spec.key] = entry;
  copied += 1;
  console.log(`[publish-downloads] ${hit.name} → downloads/${spec.file} (${entry.sizeBytes} bytes)`);
}

releases.version = pkg.version;
releases.updatedAt = today;
fs.writeFileSync(releasesPath, `${JSON.stringify(releases, null, 2)}\n`, 'utf8');

if (!copied) {
  console.error('[publish-downloads] Nothing copied. Build first with ship:win:prod / ship:mac:prod.');
  process.exit(1);
}

console.log(`[publish-downloads] Updated ${releasesPath}`);
console.log('[publish-downloads] Sync website/ to the server when ready (see website/README.md).');
