/**
 * Generate Windows .ico, tray .ico, PNG sizes, and macOS .icns from brand mark.
 *
 * Source preference:
 *   1) src/renderer/workstation/assets/brand/workhorse-mark.png
 *   2) public/logo.png
 *
 * GDI+ cannot reliably open non-ASCII paths, so the source is copied to %TEMP% first.
 * macOS .icns is built with png2icons (works on Windows; final Mac build still uses this file).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CANDIDATES = [
  path.join(ROOT, 'src', 'renderer', 'workstation', 'assets', 'brand', 'workhorse-mark.png'),
  path.join(ROOT, 'public', 'logo.png'),
];
const SOURCE = CANDIDATES.find((p) => fs.existsSync(p));
if (!SOURCE) {
  console.error('No brand mark found. Expected workhorse-mark.png or public/logo.png');
  process.exit(1);
}

const OUT_WIN = path.join(ROOT, 'build', 'icons', 'win', 'icon.ico');
const OUT_TRAY = path.join(ROOT, 'resources', 'tray', 'tray-icon.ico');
const OUT_MAC = path.join(ROOT, 'build', 'icons', 'mac', 'icon.icns');
const OUT_PNG_DIR = path.join(ROOT, 'build', 'icons', 'png');
const ICO_SIZES = [256, 128, 64, 48, 32, 16];
const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

fs.mkdirSync(path.dirname(OUT_WIN), { recursive: true });
fs.mkdirSync(path.dirname(OUT_TRAY), { recursive: true });
fs.mkdirSync(path.dirname(OUT_MAC), { recursive: true });
fs.mkdirSync(OUT_PNG_DIR, { recursive: true });

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-icon-'));
const asciiSource = path.join(tmpDir, 'source.png');
fs.copyFileSync(SOURCE, asciiSource);

const allSizes = [...new Set([...ICO_SIZES, ...PNG_SIZES])].sort((a, b) => b - a);
const psScript = `
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$src = [System.Drawing.Image]::FromFile('${asciiSource.replace(/'/g, "''")}')
$sizes = @(${allSizes.join(',')})
$outDir = '${tmpDir.replace(/'/g, "''")}'
foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($src, 0, 0, $s, $s)
    $g.Dispose()
    $outPath = Join-Path $outDir ("icon_$s.png")
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
$src.Dispose()
`;
const psFile = path.join(tmpDir, 'resize.ps1');
fs.writeFileSync(psFile, psScript, 'utf8');
execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, { stdio: 'inherit' });

function packIco(sizes) {
  const pngBuffers = sizes.map((s) => ({
    size: s,
    data: fs.readFileSync(path.join(tmpDir, `icon_${s}.png`)),
  }));
  const count = pngBuffers.length;
  const headerSize = 6;
  const entrySize = 16;
  let currentOffset = headerSize + entrySize * count;
  const entries = pngBuffers.map(({ size, data }) => {
    const entry = {
      width: size >= 256 ? 0 : size,
      height: size >= 256 ? 0 : size,
      dataSize: data.length,
      offset: currentOffset,
      data,
    };
    currentOffset += data.length;
    return entry;
  });
  const ico = Buffer.alloc(currentOffset);
  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(count, 4);
  entries.forEach((e, i) => {
    const off = headerSize + i * entrySize;
    ico.writeUInt8(e.width, off + 0);
    ico.writeUInt8(e.height, off + 1);
    ico.writeUInt8(0, off + 2);
    ico.writeUInt8(0, off + 3);
    ico.writeUInt16LE(1, off + 4);
    ico.writeUInt16LE(32, off + 6);
    ico.writeUInt32LE(e.dataSize, off + 8);
    ico.writeUInt32LE(e.offset, off + 12);
  });
  entries.forEach((e) => e.data.copy(ico, e.offset));
  return ico;
}

const ico = packIco(ICO_SIZES);
fs.writeFileSync(OUT_WIN, ico);
fs.writeFileSync(OUT_TRAY, ico);
console.log(`Source: ${SOURCE}`);
console.log(`Generated ${OUT_WIN} (${ICO_SIZES.join(', ')}px) — ${ico.length} bytes`);
console.log(`Generated ${OUT_TRAY}`);

for (const s of PNG_SIZES) {
  const from = path.join(tmpDir, `icon_${s}.png`);
  const to = path.join(OUT_PNG_DIR, `${s}x${s}.png`);
  fs.copyFileSync(from, to);
  // Naming used by regenerate-mac-icon.sh
  fs.copyFileSync(from, path.join(OUT_PNG_DIR, `icon_${s}x${s}.png`));
}
// @2x aliases for iconutil iconset
const alias2x = [
  [16, 32],
  [32, 64],
  [128, 256],
  [256, 512],
  [512, 1024],
];
for (const [base, doubled] of alias2x) {
  const src = path.join(tmpDir, `icon_${doubled}.png`);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(OUT_PNG_DIR, `icon_${base}x${base}@2x.png`));
  }
}
console.log(`Generated PNG sizes in ${OUT_PNG_DIR}`);

const master1024 = path.join(tmpDir, 'icon_1024.png');
const icnsOutBase = path.join(tmpDir, 'workhorse-icon');
const png2 = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['--yes', 'png2icons', master1024, icnsOutBase, '-icns', '-bc', '-i'],
  { cwd: ROOT, encoding: 'utf8', shell: true },
);
if (png2.status !== 0) {
  console.error(png2.stdout || '');
  console.error(png2.stderr || '');
  console.error('Failed to generate macOS .icns via png2icons');
  process.exit(1);
}
const generatedIcns = `${icnsOutBase}.icns`;
if (!fs.existsSync(generatedIcns)) {
  console.error(`png2icons did not produce ${generatedIcns}`);
  process.exit(1);
}
if (fs.existsSync(OUT_MAC)) {
  fs.copyFileSync(OUT_MAC, `${OUT_MAC}.backup`);
}
fs.copyFileSync(generatedIcns, OUT_MAC);
console.log(`Generated ${OUT_MAC} — ${fs.statSync(OUT_MAC).size} bytes`);

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('Done. Rebuild with: npm run dist:mac / dist:win');
