/**
 * Live async discovery smoke: HTTP 202 + Worker + PostgreSQL.
 * Usage (separate terminals):
 *   npm run worker:leads
 *   PORT=3011 npx tsx src/server.ts
 *   npm run smoke:leads:queue
 *
 * Requires isolated Redis (LEAD_QUEUE_REDIS_*) — not Firecrawl's Redis.
 */
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { env } from '../src/config/env';

const BASE = process.env.SMOKE_API_BASE_URL?.replace(/\/$/, '') || `http://127.0.0.1:${process.env.SMOKE_API_PORT || '3011'}`;
const QUERY = 'medical device distributors Saudi Arabia';

async function json(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Non-JSON ${res.status}: ${text.slice(0, 300)}`);
  }
}

async function main() {
  console.log('[smoke-queue] api=', BASE);
  console.log('[smoke-queue] redis=', `${env.leadQueueRedisHost}:${env.leadQueueRedisPort} db=${env.leadQueueRedisDb}`);
  console.log('[smoke-queue] queue=', env.leadDiscoveryQueueName);
  console.log('[smoke-queue] searxng=', env.searxngBaseUrl || '(empty)');
  console.log('[smoke-queue] firecrawl=', env.firecrawlBaseUrl || '(empty)');
  console.log('[smoke-queue] keelead=', env.keeleadBaseUrl || '(empty)');

  if (!env.searxngBaseUrl) throw new Error('SEARXNG_BASE_URL required');
  if (!env.firecrawlBaseUrl) throw new Error('FIRECRAWL_BASE_URL required');

  const suffix = Date.now();
  const email = process.env.SMOKE_EMAIL || 'demo@example.com';
  const password = process.env.SMOKE_PASSWORD || env.demoUserPassword;

  const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await json(loginRes);
  if (loginRes.status !== 200) {
    throw new Error(`login failed ${loginRes.status}: ${JSON.stringify(loginBody)}`);
  }
  const data = loginBody.data as {
    accessToken: string;
    organizations: Array<{ id: string }>;
  };
  const token = data.accessToken;
  const organizationId = data.organizations[0]?.id;
  if (!token || !organizationId) throw new Error('login missing token/org');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Organization-Id': organizationId,
  };

  const postStarted = Date.now();
  const postRes = await fetch(`${BASE}/api/v1/leads/discovery`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: QUERY, maxCandidates: 1 }),
  });
  const postMs = Date.now() - postStarted;
  const postBody = await json(postRes);
  console.log('[smoke-queue] POST status', postRes.status, 'ms', postMs);
  console.log('[smoke-queue] POST body', JSON.stringify(postBody));

  if (postRes.status !== 202) {
    throw new Error(`expected 202, got ${postRes.status}`);
  }
  if (postMs > 8_000) {
    throw new Error(`POST took ${postMs}ms — still looks synchronous`);
  }

  const task = (postBody.data as { task: { id: string; status: string } }).task;
  if (!task?.id) throw new Error('missing task.id');
  if (task.status !== 'PENDING') throw new Error(`expected PENDING, got ${task.status}`);

  const seen: string[] = [task.status];
  let current = task.status;
  const pollStarted = Date.now();
  while (Date.now() - pollStarted < 180_000) {
    const getRes = await fetch(`${BASE}/api/v1/leads/search-tasks/${task.id}`, { headers });
    const getBody = await json(getRes);
    if (getRes.status !== 200) {
      throw new Error(`GET task ${getRes.status}: ${JSON.stringify(getBody)}`);
    }
    current = (getBody.data as { task: { status: string } }).task.status;
    if (seen[seen.length - 1] !== current) seen.push(current);
    console.log('[smoke-queue] poll', current, 'elapsedMs', Date.now() - pollStarted);
    if (current === 'COMPLETED' || current === 'FAILED') break;
    await new Promise((r) => setTimeout(r, 2_000));
  }

  console.log('[smoke-queue] statusPath', seen.join(' -> '));
  if (current !== 'COMPLETED') {
    throw new Error(`task ended as ${current}, expected COMPLETED`);
  }

  await connectDatabase();
  try {
    const companies = await prisma.leadCompany.count({ where: { organizationId } });
    const sources = await prisma.leadSourceRecord.findMany({
      where: { organizationId, searchTaskId: task.id },
      select: { provider: true, sourceType: true },
    });
    const providers = [...new Set(sources.map((s) => s.provider))].sort();
    console.log('[smoke-queue] companies', companies);
    console.log('[smoke-queue] sourceProviders', providers);
    console.log('[smoke-queue] sourceCount', sources.length);
    if (companies < 1) throw new Error('no LeadCompany persisted');
    if (!providers.includes('SEARXNG')) throw new Error('missing SEARXNG source');
    if (!providers.includes('FIRECRAWL')) throw new Error('missing FIRECRAWL source');

    const listRes = await fetch(`${BASE}/api/v1/leads/search-tasks`, { headers });
    const resultsRes = await fetch(`${BASE}/api/v1/leads/search-tasks/${task.id}/results`, { headers });
    console.log('[smoke-queue] GET list', listRes.status, 'results', resultsRes.status);
    if (listRes.status !== 200 || resultsRes.status !== 200) {
      throw new Error('regression: list/results not 200');
    }
  } finally {
    await disconnectDatabase();
  }

  console.log('[smoke-queue] OK postMs=', postMs, 'taskId=', task.id);
}

main().catch((err) => {
  console.error('[smoke-queue] FAILED', err);
  process.exit(1);
});
