const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SKIP_DIR = new Set([
  'node_modules', 'dist', 'dist-electron', '.git', 'openclaw-main',
  'vendor', 'release', 'out', '.vite', 'Cache', 'blob_storage'
]);
const SKIP_FILE = new Set(['package-lock.json']);
const EXT = new Set([
  '.ts','.tsx','.js','.jsx','.mjs','.cjs','.json','.html','.css','.scss',
  '.md','.txt','.yml','.yaml','.plist','.xml','.svg','.env','.example'
]);

function walk(dir, out=[]) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.env.example') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walk(p, out);
    } else {
      if (SKIP_FILE.has(e.name)) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!EXT.has(ext) && !e.name.endsWith('.example')) continue;
      out.push(p);
    }
  }
  return out;
}

function transform(content, file) {
  let s = content;
  const before = s;

  // Protect technical tokens
  const holders = [];
  const protect = (re) => {
    s = s.replace(re, (m) => {
      const key = `__WH_PROTECT_${holders.length}__`;
      holders.push(m);
      return key;
    });
  };

  protect(/lobsterai-server/gi);
  protect(/lobsterai:\/\//gi);
  protect(/com\.lobsterai\.app/gi);
  protect(/lobsterai_im_bot_config_guide/gi);
  protect(/lobsterai_app_started/gi);
  protect(/lobsterai_app_/gi);
  protect(/action=lobsterai_/gi);
  protect(/LOBSTERAI_DISABLE_GPU/g);
  protect(/WORKHORSEAI_[A-Z0-9_]+/g);
  protect(/VITE_.*LOBSTER.*/gi);
  protect(/bx-aigc\.com[^\s"'`]*/g);
  protect(/rd\.netease\.com[^\s"'`]*/g);
  protect(/lobsterai\.project@/gi);

  // Display / product renames
  s = s.replace(/Workhorse AI/g, 'Workhorse AI');
  s = s.replace(/Workhorse AI/g, 'Workhorse AI');
  s = s.replace(/Workhorse AI/g, 'Workhorse AI');
  s = s.replace(/WORKHORSEAI/g, 'WORKHORSEAI');

  // lowercase identifiers used as brand in copy (careful)
  // only replace standalone lobsterai word in quotes/titles-ish contexts is hard;
  // do common display-ish patterns:
  s = s.replace(/'workhorseai'/g, "'workhorseai'");
  s = s.replace(/"workhorseai"/g, '"workhorseai"');
  s = s.replace(/`workhorseai`/g, '`workhorseai`');

  // Restore protected
  holders.forEach((m, i) => {
    s = s.split(`__WH_PROTECT_${i}__`).join(m);
  });

  return s === before ? null : s;
}

const files = walk(ROOT);
let changed = 0;
const list = [];
for (const f of files) {
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (!/Workhorse AI|Workhorse AI|lobsterai|WORKHORSEAI|Workhorse AI/.test(raw)) continue;
  const next = transform(raw, f);
  if (!next) continue;
  fs.writeFileSync(f, next, 'utf8');
  changed++;
  list.push(path.relative(ROOT, f).replace(/\\/g, '/'));
}
console.log('CHANGED', changed);
list.slice(0, 80).forEach(f => console.log(f));
if (list.length > 80) console.log('... +' + (list.length-80) + ' more');
