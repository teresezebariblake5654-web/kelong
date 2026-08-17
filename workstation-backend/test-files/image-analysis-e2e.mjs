/* E2E test for POST /api/v1/ai/analyze-image. Run: node image-analysis-e2e.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:3001';
const DIR = path.dirname(fileURLToPath(import.meta.url));

const results = [];
function record(name, ok, note = '') {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ' — ' + note : ''}`);
}

async function api(pathName, { method = 'GET', token, orgId, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (orgId) headers['X-Organization-Id'] = orgId;
  let requestBody;
  if (form) {
    requestBody = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${pathName}`, { method, headers, body: requestBody });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, rawText: text };
}

async function upload(token, orgId, filePath, mime) {
  const form = new FormData();
  const buffer = fs.readFileSync(filePath);
  form.append('file', new Blob([buffer], { type: mime }), path.basename(filePath));
  return api('/api/files/upload', { method: 'POST', token, orgId, form });
}

async function analyzeImage(token, orgId, fileId) {
  return api('/api/v1/ai/analyze-image', {
    method: 'POST',
    token,
    orgId,
    body: { fileId, instruction: '识别并分析图片内容' },
  });
}

// --- 1. login demo user ---
const login = await api('/api/v1/auth/login', {
  method: 'POST',
  body: { email: 'demo@example.com', password: 'DemoPass123!' },
});
if (login.status !== 200) {
  console.error('login failed', login.status, login.rawText);
  process.exit(1);
}
const tokenA = login.json.data.accessToken;
const orgA = login.json.data.organizations[0].id;
console.log('logged in, org:', orgA);

// --- 2. PNG / JPG / WEBP recognition ---
const cases = [
  ['vision-test.png', 'image/png', 'PNG'],
  ['vision-test.jpg', 'image/jpeg', 'JPG'],
  ['vision-test.webp', 'image/webp', 'WEBP'],
];
let pngFileId = null;
for (const [fileName, mime, label] of cases) {
  const up = await upload(tokenA, orgA, path.join(DIR, fileName), mime);
  if (up.status !== 201) {
    record(`${label} 上传`, false, `${up.status} ${up.rawText.slice(0, 200)}`);
    continue;
  }
  const fileId = up.json.data.fileId;
  if (label === 'PNG') pngFileId = fileId;
  const an = await analyzeImage(tokenA, orgA, fileId);
  const ok =
    an.status === 200 &&
    an.json.data?.status === 'COMPLETED' &&
    typeof an.json.data?.result?.summary === 'string' &&
    an.json.data.result.summary.length > 0;
  record(`${label} 识别`, ok, ok ? `summary=${an.json.data.result.summary.slice(0, 60)}` : `${an.status} ${an.rawText.slice(0, 200)}`);
  if (ok && label === 'PNG') {
    const raw = an.rawText.toLowerCase();
    const leak = ['deepseek', 'provider', 'apikey', 'api_key', 'gpt-', 'openai', 'tokken'].filter((k) => raw.includes(k));
    record('响应不暴露供应商/模型', leak.length === 0, leak.length ? `泄露字段: ${leak.join(',')}` : '仅 status/result');
    console.log('   extractedText:', JSON.stringify(an.json.data.result.extractedText).slice(0, 120));
    console.log('   details:', JSON.stringify(an.json.data.result.details).slice(0, 200));
  }
}

// --- 3. non-image rejected ---
const upCsv = await upload(tokenA, orgA, path.join(DIR, 'vision-test.csv'), 'text/csv');
if (upCsv.status === 201) {
  const anCsv = await analyzeImage(tokenA, orgA, upCsv.json.data.fileId);
  record('非图片文件被拒绝', anCsv.status === 400 && anCsv.json.code === 'INVALID_IMAGE_FILE', `${anCsv.status} ${anCsv.json.code ?? ''} ${anCsv.json.message ?? ''}`);
} else {
  record('非图片文件被拒绝', false, `csv 上传失败 ${upCsv.status}`);
}

// --- 4. cross-organization isolation ---
const suffix = Date.now();
const reg = await api('/api/v1/auth/register', {
  method: 'POST',
  body: {
    email: `vision-e2e-${suffix}@example.com`,
    username: `visione2e${suffix}`,
    password: 'VisionE2e123!',
    organizationName: `视觉测试组织${suffix}`,
  },
});
if (reg.status !== 200 && reg.status !== 201) {
  record('跨组织隔离', false, `注册失败 ${reg.status} ${reg.rawText.slice(0, 200)}`);
} else {
  const tokenB = reg.json.data.accessToken;
  const orgB = reg.json.data.organizations[0].id;
  const crossOwnOrg = await analyzeImage(tokenB, orgB, pngFileId);
  record('他组织文件不可识别（own org）', crossOwnOrg.status === 404, `${crossOwnOrg.status} ${crossOwnOrg.json.code ?? ''}`);
  const crossForeignOrg = await analyzeImage(tokenB, orgA, pngFileId);
  record('冒用他人组织头被拒', crossForeignOrg.status === 403 || crossForeignOrg.status === 404, `${crossForeignOrg.status} ${crossForeignOrg.json.code ?? ''}`);
}

// --- 5. auth checks ---
const noAuth = await analyzeImage(null, orgA, pngFileId ?? 'x');
record('未登录被拒 (401)', noAuth.status === 401, `${noAuth.status}`);
const noOrg = await analyzeImage(tokenA, null, pngFileId ?? 'x');
record('缺少 X-Organization-Id 被拒 (400)', noOrg.status === 400, `${noOrg.status} ${noOrg.json.code ?? ''}`);

console.log('\n==== SUMMARY ====');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
