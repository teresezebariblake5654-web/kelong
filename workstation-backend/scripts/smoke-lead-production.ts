/**
 * Real smokes for 阶段1 AI自动获客封版.
 *
 * Usage:
 *   npm run worker:leads
 *   PORT=3011 npx tsx src/server.ts
 *   npm run smoke:leads:production
 *
 * Isolated LobsterAI Redis (LEAD_QUEUE_REDIS_*) must NOT be Firecrawl Redis.
 *
 * SMOKE_STEPS=123 (default) runs all three:
 *   1 = full acquisition targetCount=10
 *   2 = cancel while RUNNING
 *   3 = KeeLead unavailable still keeps emails
 */
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { env } from '../src/config/env';

const BASE =
  process.env.SMOKE_API_BASE_URL?.replace(/\/$/, '') ||
  `http://127.0.0.1:${process.env.SMOKE_API_PORT || '3011'}`;

async function json(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Non-JSON ${res.status}: ${text.slice(0, 300)}`);
  }
}

async function login() {
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
  return {
    token,
    organizationId,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Organization-Id': organizationId,
    },
  };
}

async function pollTask(
  headers: Record<string, string>,
  taskId: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  const phases: string[] = [];
  const statuses: string[] = [];
  for (;;) {
    const res = await fetch(`${BASE}/api/v1/leads/search-tasks/${taskId}`, { headers });
    const body = await json(res);
    const task = (body.data as { task?: Record<string, unknown> })?.task;
    const status = typeof task?.status === 'string' ? task.status : '';
    if (status && statuses[statuses.length - 1] !== status) statuses.push(status);
    const progress = task?.progress as { phase?: string; counters?: Record<string, number> } | undefined;
    if (progress?.phase && phases[phases.length - 1] !== progress.phase) {
      phases.push(progress.phase);
      console.log('[smoke-prod] phase', progress.phase, JSON.stringify(progress));
    }
    if (task && (task.status === 'COMPLETED' || task.status === 'FAILED' || task.status === 'CANCELLED')) {
      return { ...task, _phases: phases, _statuses: statuses };
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timeout waiting for task ${taskId}: ${JSON.stringify(task)}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function smoke1(headers: Record<string, string>) {
  console.log('\n=== Smoke 1: targetCount=10 cardiovascular medical device distributors Saudi Arabia ===');
  const postRes = await fetch(`${BASE}/api/v1/leads/discovery`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: 'cardiovascular medical device distributors Saudi Arabia',
      targetCount: 10,
    }),
  });
  const postBody = await json(postRes);
  console.log('[smoke-prod] 1 POST', postRes.status, JSON.stringify(postBody).slice(0, 500));
  if (postRes.status !== 202) throw new Error(`Smoke 1 expected 202, got ${postRes.status}`);
  const taskId = (postBody.data as { task: { id: string; targetCount?: number } }).task.id;
  const postedTarget = (postBody.data as { task: { targetCount?: number } }).task.targetCount;
  if (postedTarget !== 10) {
    throw new Error(`Smoke 1 POST targetCount=${postedTarget}, expected 10`);
  }

  const created = await prisma.leadSearchTask.findUnique({ where: { id: taskId } });
  if (created?.targetCount !== 10) {
    throw new Error(`Smoke 1 DB targetCount=${created?.targetCount}, expected 10 (must not clip to 5)`);
  }
  if (created.status !== 'PENDING' && created.status !== 'RUNNING') {
    throw new Error(`Smoke 1 expected PENDING/RUNNING after enqueue, got ${created.status}`);
  }

  const task = await pollTask(headers, taskId, 600_000);
  console.log('[smoke-prod] 1 final', task.status, 'statuses', task._statuses, 'phases', task._phases);
  if (task.status !== 'COMPLETED') throw new Error(`Smoke 1 expected COMPLETED, got ${task.status}`);
  const statuses = task._statuses as string[];
  if (!statuses.includes('PENDING') && created.status !== 'PENDING') {
    console.log('[smoke-prod] 1 note: PENDING was already consumed before first poll');
  }
  if (!statuses.includes('RUNNING') && created.status !== 'RUNNING') {
    console.log('[smoke-prod] 1 note: RUNNING may have been brief');
  }

  const row = await prisma.leadSearchTask.findUnique({ where: { id: taskId } });
  const meta = (row?.metadata ?? {}) as Record<string, unknown>;
  const outcome = meta.outcome as Record<string, unknown> | undefined;
  if (row?.targetCount !== 10) {
    throw new Error(`Smoke 1 final targetCount=${row?.targetCount}, expected 10`);
  }
  if (outcome?.requestedTarget !== 10) {
    throw new Error(`Smoke 1 requestedTarget=${outcome?.requestedTarget}, expected 10`);
  }

  const companies = await prisma.leadCompany.findMany({
    where: { organizationId: created.organizationId, sourceRecords: { some: { searchTaskId: taskId } } },
  });
  const sources = await prisma.leadSourceRecord.findMany({ where: { searchTaskId: taskId } });
  const contacts = await prisma.leadContact.findMany({
    where: { company: { sourceRecords: { some: { searchTaskId: taskId } } } },
  });
  const scores = await prisma.leadScore.findMany({ where: { searchTaskId: taskId } });
  console.log('[smoke-prod] 1 outcome', outcome);
  console.log(
    '[smoke-prod] 1 rows',
    'LeadCompany',
    companies.length,
    'LeadSourceRecord',
    sources.length,
    'LeadContact',
    contacts.length,
    'LeadScore',
    scores.length,
  );
  if (companies.length < 1) throw new Error('Smoke 1 expected LeadCompany rows');
  if (sources.length < 1) throw new Error('Smoke 1 expected LeadSourceRecord rows');
  if (contacts.length < 1) throw new Error('Smoke 1 expected LeadContact rows');
  if (scores.length < 1) throw new Error('Smoke 1 expected auto LeadScore rows');
  return {
    taskId,
    status: task.status,
    requestedTarget: outcome?.requestedTarget,
    companies: companies.length,
    sources: sources.length,
    contacts: contacts.length,
    scores: scores.length,
    targetReached: outcome?.targetReached,
    stopReason: outcome?.stopReason,
  };
}

async function smoke2(headers: Record<string, string>) {
  console.log('\n=== Smoke 2: cancel RUNNING task ===');
  const postRes = await fetch(`${BASE}/api/v1/leads/discovery`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: 'cardiovascular medical device distributors Saudi Arabia',
      targetCount: 3,
    }),
  });
  const postBody = await json(postRes);
  if (postRes.status !== 202) throw new Error(`Smoke 2 expected 202, got ${postRes.status}`);
  const taskId = (postBody.data as { task: { id: string } }).task.id;

  let sawRunning = false;
  for (let i = 0; i < 80; i += 1) {
    const res = await fetch(`${BASE}/api/v1/leads/search-tasks/${taskId}`, { headers });
    const body = await json(res);
    const task = (body.data as { task?: { status?: string; progress?: { phase?: string } } }).task;
    if (task?.status === 'RUNNING' || task?.progress?.phase === 'SEARCHING' || task?.progress?.phase === 'PLANNING') {
      sawRunning = true;
      break;
    }
    if (task?.status === 'COMPLETED' || task?.status === 'FAILED' || task?.status === 'CANCELLED') {
      break;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!sawRunning) {
    console.log('[smoke-prod] 2 warning: did not observe RUNNING before cancel; cancelling anyway');
  }

  const cancelRes = await fetch(`${BASE}/api/v1/leads/search-tasks/${taskId}/cancel`, {
    method: 'POST',
    headers,
  });
  const cancelBody = await json(cancelRes);
  console.log('[smoke-prod] 2 cancel', cancelRes.status, JSON.stringify(cancelBody).slice(0, 400));
  const task = await pollTask(headers, taskId, 90_000);
  if (task.status !== 'CANCELLED') {
    throw new Error(`Smoke 2 expected CANCELLED, got ${task.status}`);
  }
  const row = await prisma.leadSearchTask.findUnique({ where: { id: taskId } });
  if (row?.status === 'FAILED' || row?.status === 'COMPLETED') {
    throw new Error(`Smoke 2 cancelled task was overwritten to ${row.status}`);
  }
  await new Promise((r) => setTimeout(r, 4_000));
  const later = await prisma.leadSearchTask.findUnique({ where: { id: taskId } });
  if (later?.status !== 'CANCELLED') {
    throw new Error(`Smoke 2 retried after cancel: ${later?.status}`);
  }
  return { taskId, status: task.status, retried: false };
}

async function smoke3(headers: Record<string, string>) {
  console.log('\n=== Smoke 3: KeeLead unavailable still keeps emails ===');
  const healthRes = await fetch(`${BASE}/api/v1/leads/provider-health`, { headers });
  const healthBody = await json(healthRes);
  console.log('[smoke-prod] 3 health', healthRes.status, JSON.stringify(healthBody).slice(0, 800));
  if (healthRes.status !== 200) throw new Error(`Smoke 3 health expected 200, got ${healthRes.status}`);

  const keeleadConfigured = Boolean(env.keeleadBaseUrl && env.keeleadProviderKey);
  console.log('[smoke-prod] 3 keelead configured', keeleadConfigured, 'base', env.keeleadBaseUrl || '(empty)');
  if (keeleadConfigured) {
    console.log('[smoke-prod] 3 note: KEELEAD_PROVIDER_KEY is set; failure depends on KeeLead being down/unreachable');
  } else {
    console.log('[smoke-prod] 3 using safe failure config: KeeLead key/url missing → verify errors, emails still saved');
  }

  const postRes = await fetch(`${BASE}/api/v1/leads/discovery`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: 'cardiovascular medical device distributors Saudi Arabia',
      targetCount: 3,
    }),
  });
  const postBody = await json(postRes);
  if (postRes.status !== 202) throw new Error(`Smoke 3 expected 202, got ${postRes.status}`);
  const taskId = (postBody.data as { task: { id: string } }).task.id;
  const task = await pollTask(headers, taskId, 600_000);
  console.log('[smoke-prod] 3 final', task.status);
  if (task.status === 'FAILED') {
    throw new Error(`Smoke 3 KeeLead failure must not FAIL the whole task: ${JSON.stringify(task)}`);
  }
  if (task.status !== 'COMPLETED' && task.status !== 'CANCELLED') {
    throw new Error(`Smoke 3 unexpected status ${task.status}`);
  }
  if (task.status !== 'COMPLETED') {
    throw new Error(`Smoke 3 expected COMPLETED despite KeeLead failure, got ${task.status}`);
  }

  const emails = await prisma.leadContact.findMany({
    where: {
      email: { not: null },
      company: { sourceRecords: { some: { searchTaskId: taskId } } },
    },
  });
  console.log(
    '[smoke-prod] 3 emails',
    emails.length,
    emails.slice(0, 5).map((e) => ({
      email: e.email,
      status: e.emailVerificationStatus,
      score: e.emailVerificationScore,
    })),
  );
  if (emails.length < 1) throw new Error('Smoke 3 expected Firecrawl emails to still persist');
  const forged = emails.filter((e) => e.emailVerificationStatus === 'valid' && !keeleadConfigured);
  if (forged.length > 0) {
    throw new Error('Smoke 3 must not forge verified=true when KeeLead is unavailable');
  }
  return { taskId, status: task.status, emails: emails.length, keeleadConfigured };
}

async function main() {
  console.log('[smoke-prod] api=', BASE);
  console.log('[smoke-prod] redis=', `${env.leadQueueRedisHost}:${env.leadQueueRedisPort} db=${env.leadQueueRedisDb}`);
  console.log('[smoke-prod] NOTE: LobsterAI Redis must not be Firecrawl Redis');
  if (!env.searxngBaseUrl) throw new Error('SEARXNG_BASE_URL required');
  if (!env.firecrawlBaseUrl) throw new Error('FIRECRAWL_BASE_URL required');

  await connectDatabase();
  try {
    const { headers, organizationId } = await login();
    const leftover = await prisma.leadSearchTask.findMany({
      where: { organizationId, status: { in: ['PENDING', 'RUNNING'] } },
      select: { id: true, status: true },
    });
    for (const row of leftover) {
      console.log('[smoke-prod] cancelling leftover active task', row.id, row.status);
      await fetch(`${BASE}/api/v1/leads/search-tasks/${row.id}/cancel`, {
        method: 'POST',
        headers,
      });
    }
    if (leftover.length) await new Promise((r) => setTimeout(r, 1500));
    const raw = (process.env.SMOKE_STEPS || '123').toUpperCase();
    const steps = raw.replace(/A/g, '1').replace(/B/g, '1').replace(/C/g, '2').replace(/D/g, '3');
    const one = steps.includes('1') ? await smoke1(headers) : { skipped: true };
    const two = steps.includes('2') ? await smoke2(headers) : { skipped: true };
    const three = steps.includes('3') ? await smoke3(headers) : { skipped: true };
    console.log('\n=== production smoke summary ===');
    console.log(JSON.stringify({ smoke1: one, smoke2: two, smoke3: three }, null, 2));
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err) => {
  console.error('[smoke-prod] FAILED', err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
