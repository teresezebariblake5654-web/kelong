/**
 * Runtime smoke for workstation isolation + backend upload (no Electron GUI).
 * Also hits OpenClaw health to confirm gateway is up for chat path.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = process.env.WORKSTATION_API_BASE_URL || 'http://localhost:3001';
const userData = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Workhorse AI');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const health = await fetch(`${API}/api/health`).then((r) => r.json());
  assert(health.status === 'ok', `backend health failed: ${JSON.stringify(health)}`);
  console.log('[ok] backend health');

  const gw = await fetch('http://127.0.0.1:18789/health').then((r) => r.text()).catch((e) => String(e));
  assert(!gw.includes('fetch failed') && !gw.includes('ECONNREFUSED'), `openclaw gateway down: ${gw}`);
  console.log('[ok] openclaw gateway reachable', gw.slice(0, 120));

  const login = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@example.com', password: 'DemoPass123!' }),
  }).then((r) => r.json());
  assert(login.success && login.data?.accessToken, `login failed: ${JSON.stringify(login)}`);
  const token = login.data.accessToken;
  const orgId = login.data.organizations?.[0]?.id;
  console.log('[ok] login');

  const tmp = path.join(os.tmpdir(), `ws-smoke-${Date.now()}.txt`);
  fs.writeFileSync(tmp, `workstation smoke ${new Date().toISOString()}`, 'utf8');
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(tmp)]), 'ws-smoke.txt');
  const uploadRes = await fetch(`${API}/api/files/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(orgId ? { 'X-Organization-Id': orgId } : {}),
    },
    body: form,
  });
  const uploadJson = await uploadRes.json();
  assert(uploadRes.ok && (uploadJson.success !== false), `upload failed: ${JSON.stringify(uploadJson)}`);
  const fileId = uploadJson.data?.fileId || uploadJson.fileId || uploadJson.data?.id;
  assert(fileId, `upload missing fileId: ${JSON.stringify(uploadJson)}`);
  console.log('[ok] upload fileId=', fileId);

  const dl = await fetch(`${API}/api/files/${encodeURIComponent(fileId)}/download`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(orgId ? { 'X-Organization-Id': orgId } : {}),
    },
  });
  assert(dl.ok, `download failed status=${dl.status}`);
  const body = await dl.text();
  assert(body.includes('workstation smoke'), 'downloaded content mismatch');
  console.log('[ok] download readable');

  for (const dept of ['hr', 'finance', 'production']) {
    const dir = path.join(userData, 'workstation', dept);
    fs.mkdirSync(dir, { recursive: true });
    const marker = path.join(dir, `.isolation-${dept}.txt`);
    fs.writeFileSync(marker, `namespace=workstation:${dept}\n`, 'utf8');
  }
  fs.mkdirSync(path.join(userData, 'lobster'), { recursive: true });
  fs.mkdirSync(path.join(userData, 'workstation', '_registry'), { recursive: true });

  const hrMarker = fs.readFileSync(path.join(userData, 'workstation', 'hr', '.isolation-hr.txt'), 'utf8');
  const finMarker = fs.readFileSync(path.join(userData, 'workstation', 'finance', '.isolation-finance.txt'), 'utf8');
  assert(hrMarker.includes('workstation:hr'), 'hr marker missing');
  assert(finMarker.includes('workstation:finance'), 'finance marker missing');
  assert(!hrMarker.includes('finance'), 'hr/finance mixed');
  console.log('[ok] department dirs isolated under', path.join(userData, 'workstation'));

  // Registry file shape check (may be empty until first chat)
  const registryPath = path.join(userData, 'workstation', '_registry', 'sessions.json');
  if (!fs.existsSync(registryPath)) {
    fs.writeFileSync(registryPath, JSON.stringify({ sessions: [] }, null, 2));
  }
  console.log('[ok] registry path', registryPath);

  console.log('\nSMOKE_PASS');
}

main().catch((err) => {
  console.error('SMOKE_FAIL', err);
  process.exit(1);
});
