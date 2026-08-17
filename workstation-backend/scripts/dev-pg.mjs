/**
 * Local PostgreSQL for Windows development (default path when Docker/WSL unavailable).
 * Credentials match docker-compose.yml.
 *
 * Default data root: C:\aw-pg (ASCII path required — embedded-postgres cannot live
 * under non-ASCII paths such as Chinese folder names).
 * Override with AW_PG_ROOT (must be an ASCII-only absolute path on Windows).
 *
 * Usage: npm run db:up  (keep this process running)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ASCII_ROOT = process.env.AW_PG_ROOT || 'C:\\aw-pg';
const DATA_DIR = path.join(ASCII_ROOT, 'data');
const START_FILE = path.join(ASCII_ROOT, 'start.mjs');

const startSource = `import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';

const databaseDir = ${JSON.stringify(DATA_DIR)};
const pgVersion = path.join(databaseDir, 'PG_VERSION');
const pidFile = path.join(databaseDir, 'postmaster.pid');

fs.mkdirSync(databaseDir, { recursive: true });

if (fs.existsSync(pidFile)) {
  try {
    fs.unlinkSync(pidFile);
    console.log('[dev-pg] removed stale postmaster.pid');
  } catch (e) {
    console.warn('[dev-pg] could not remove postmaster.pid:', e.message);
  }
}

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'agent',
  password: 'agent_dev_password',
  port: 5432,
  persistent: true,
  initdbFlags: ['--locale=C', '--encoding=UTF8'],
  onLog: (msg) => process.stdout.write(String(msg)),
  onError: (msg) => process.stderr.write(String(msg)),
});

if (!fs.existsSync(pgVersion)) {
  console.log('[dev-pg] initialising new cluster at', databaseDir);
  await pg.initialise();
} else {
  console.log('[dev-pg] reusing existing cluster at', databaseDir);
}

await pg.start();
try {
  await pg.createDatabase('agent_workstation');
  console.log('[dev-pg] database created');
} catch (e) {
  console.log('[dev-pg] createDatabase:', e.message);
}
console.log('[dev-pg] PostgreSQL listening on localhost:5432');
console.log('[dev-pg] DATABASE_URL=postgresql://agent:agent_dev_password@localhost:5432/agent_workstation?schema=public');
console.log('[dev-pg] Keep this process running. Press Ctrl+C to stop.');
`;

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: true });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`));
    });
  });
}

function assertAsciiRoot(root) {
  if (/[^\x00-\x7F]/.test(root)) {
    throw new Error(
      `[dev-pg] AW_PG_ROOT must be ASCII-only on Windows. Got: ${root}. Example: C:\\\\aw-pg`,
    );
  }
}

async function ensureAsciiRuntime() {
  assertAsciiRoot(ASCII_ROOT);
  fs.mkdirSync(ASCII_ROOT, { recursive: true });
  if (!fs.existsSync(path.join(ASCII_ROOT, 'node_modules', 'embedded-postgres'))) {
    console.log(`[dev-pg] Bootstrapping embedded-postgres under ${ASCII_ROOT} ...`);
    if (!fs.existsSync(path.join(ASCII_ROOT, 'package.json'))) {
      await run('npm', ['init', '-y'], ASCII_ROOT);
    }
    await run('npm', ['install', 'embedded-postgres@18.4.0-beta.17'], ASCII_ROOT);
    try {
      await run('npm', ['approve-scripts', '@embedded-postgres/windows-x64'], ASCII_ROOT);
    } catch {
      console.warn('[dev-pg] approve-scripts skipped or failed; continuing');
    }
    const hydrate = path.join(
      ASCII_ROOT,
      'node_modules',
      '@embedded-postgres',
      'windows-x64',
      'scripts',
      'hydrate-symlinks.js',
    );
    if (fs.existsSync(hydrate)) {
      await run('node', [hydrate], ASCII_ROOT);
    }
  }
  fs.writeFileSync(START_FILE, startSource, { encoding: 'utf8' });
}

async function main() {
  await ensureAsciiRuntime();
  console.log(`[dev-pg] Starting PostgreSQL via ${ASCII_ROOT}`);
  const child = spawn('node', [START_FILE], {
    cwd: ASCII_ROOT,
    stdio: 'inherit',
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  });
  child.on('exit', (code) => process.exit(code ?? 1));
}

main().catch((error) => {
  console.error('[dev-pg] failed:', error);
  process.exit(1);
});
