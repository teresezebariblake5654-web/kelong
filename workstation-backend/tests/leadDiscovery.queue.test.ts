import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { leadsController } from '../src/controllers/leads.controller';
import { errorMiddleware } from '../src/middleware/error.middleware';
import { AppError } from '../src/utils/errors';
import * as discoveryMod from '../src/services/leads/lead-discovery.service';
import type { DiscoveryPreviewResult } from '../src/services/leads/lead-discovery.service';
import { leadDiscoveryRunService } from '../src/services/leads/lead-discovery-run.service';
import * as queueMod from '../src/queues/lead-discovery.queue';
import {
  enqueueLeadDiscoveryJob,
  isDuplicateJobIdError,
  leadDiscoveryJobId,
  LEAD_DISCOVERY_JOB_ATTEMPTS,
  type LeadDiscoveryJobData,
} from '../src/queues/lead-discovery.queue';
import {
  handleLeadDiscoveryJobFailed,
  isFinalLeadDiscoveryFailure,
  processLeadDiscoveryJob,
} from '../src/workers/lead-discovery.worker';

function sampleDiscovery(domain: string): DiscoveryPreviewResult {
  return {
    query: 'medical device distributors Saudi Arabia',
    stats: {
      searchResults: 4,
      uniqueDomains: 1,
      researched: 1,
      successful: 1,
      pagesScraped: 1,
      keeleadVerifyCalls: 1,
    },
    companies: [
      {
        domain,
        website: `https://${domain}/`,
        search: { title: 'Example Medical', description: 'Distributor', engine: 'brave' },
        candidateKind: 'company_likely',
        researchedPages: [`https://${domain}/`],
        websiteResearch: { title: 'Example', markdownPreview: `sales@${domain}` },
        contacts: {
          emails: [
            {
              email: `sales@${domain}`,
              sourceUrl: `https://${domain}/contact`,
              verification: { status: 'valid', score: 88 },
            },
          ],
          phones: [],
          linkedin: [],
          facebook: [],
          instagram: [],
        },
        sources: ['searxng', 'firecrawl', 'keelead'],
      },
    ],
    errors: [],
    durationMs: 8,
  };
}

function buildLeadsApp(opts: { orgId: string }) {
  const app = express();
  app.use(express.json());
  const attach = (
    method: 'post' | 'get',
    path: string,
    handler: (req: express.Request, res: express.Response, next: express.NextFunction) => unknown,
  ) => {
    app[method](path, (req, res, next) => {
      req.user = {
        id: 'u1',
        username: 'tester',
        email: 't@example.com',
        role: 'user',
        vipLevel: 'free',
        credits: 0,
        status: 'active',
      } as never;
      req.org = {
        organizationId: opts.orgId,
        role: 'owner',
        membershipId: 'm1',
      };
      void handler(req, res, next);
    });
  };
  attach('post', '/api/v1/leads/discovery', leadsController.discovery);
  attach('get', '/api/v1/leads/search-tasks/:taskId', leadsController.getSearchTask);
  app.use(errorMiddleware);
  return app;
}

describe('lead discovery job helpers', () => {
  it('builds a stable jobId from taskId', () => {
    expect(leadDiscoveryJobId('task_abc')).toBe('lead-discovery-task_abc');
  });

  it('detects duplicate jobId errors', () => {
    expect(isDuplicateJobIdError(new Error('Job lead-discovery-x already exists'))).toBe(true);
    expect(isDuplicateJobIdError({ name: 'JobIdAlreadyExists', message: 'dup' })).toBe(true);
    expect(isDuplicateJobIdError(new Error('ECONNREFUSED'))).toBe(false);
  });

  it('treats only the last attempt (or unrecoverable errors) as final failure', () => {
    expect(isFinalLeadDiscoveryFailure(1, 3, new Error('timeout'))).toBe(false);
    expect(isFinalLeadDiscoveryFailure(2, 3, new Error('timeout'))).toBe(false);
    expect(isFinalLeadDiscoveryFailure(3, 3, new Error('timeout'))).toBe(true);
    expect(isFinalLeadDiscoveryFailure(1, 3, new UnrecoverableError('bad payload'))).toBe(true);
    expect(isFinalLeadDiscoveryFailure(1, 3, new AppError(403, 'nope', 'ORGANIZATION_MISMATCH'))).toBe(
      true,
    );
  });

  it('enqueues only small job fields with the stable jobId', async () => {
    const added: Array<{ name: string; data: LeadDiscoveryJobData; opts: { jobId?: string } }> = [];
    const fakeQueue = {
      add: vi.fn(async (name: string, data: LeadDiscoveryJobData, opts?: { jobId?: string }) => {
        added.push({ name, data, opts: opts ?? {} });
        return { id: opts?.jobId };
      }),
    };

    const data: LeadDiscoveryJobData = {
      taskId: 't1',
      organizationId: 'org1',
      query: 'medical device distributors Saudi Arabia',
      maxCandidates: 1,
    };
    const result = await enqueueLeadDiscoveryJob(data, fakeQueue);
    expect(result).toEqual({ jobId: 'lead-discovery-t1', duplicated: false });
    expect(added[0].data).toEqual(data);
    expect(added[0].opts.jobId).toBe('lead-discovery-t1');
    expect(JSON.stringify(added[0].data)).not.toMatch(/jwt|password|apiKey|markdown/i);
  });

  it('treats a second enqueue of the same taskId as a duplicate, not a new job', async () => {
    const fakeQueue = {
      add: vi
        .fn()
        .mockResolvedValueOnce({ id: 'lead-discovery-t2' })
        .mockRejectedValueOnce(new Error('Job lead-discovery-t2 already exists')),
    };
    const data: LeadDiscoveryJobData = {
      taskId: 't2',
      organizationId: 'org1',
      query: 'q',
      maxCandidates: 1,
    };
    await enqueueLeadDiscoveryJob(data, fakeQueue);
    const second = await enqueueLeadDiscoveryJob(data, fakeQueue);
    expect(second.duplicated).toBe(true);
    expect(second.jobId).toBe('lead-discovery-t2');
    expect(fakeQueue.add).toHaveBeenCalledTimes(2);
    expect(fakeQueue.add.mock.calls[0][2].jobId).toBe(fakeQueue.add.mock.calls[1][2].jobId);
  });
});

describe('lead discovery async HTTP + worker (postgres)', () => {
  const suffix = Date.now();
  let orgA = '';
  let orgB = '';

  beforeAll(async () => {
    await connectDatabase();
    const a = await prisma.organization.create({
      data: { name: `Lead Queue A ${suffix}`, slug: `lead-queue-a-${suffix}` },
    });
    const b = await prisma.organization.create({
      data: { name: `Lead Queue B ${suffix}`, slug: `lead-queue-b-${suffix}` },
    });
    orgA = a.id;
    orgB = b.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const orgIds = [orgA, orgB].filter(Boolean);
    await prisma.leadSourceRecord.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.leadContact.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.leadCompany.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.leadSearchTask.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await disconnectDatabase();
  });

  it('POST discovery creates a PENDING task, enqueues, and returns without running discovery', async () => {
    const preview = vi
      .spyOn(discoveryMod.leadDiscoveryService, 'runDiscoveryPreview')
      .mockImplementation(() => new Promise(() => {}));
    const enqueue = vi.spyOn(queueMod, 'enqueueLeadDiscoveryJob').mockResolvedValue({
      jobId: 'lead-discovery-pending',
      duplicated: false,
    });

    const started = Date.now();
    const app = buildLeadsApp({ orgId: orgA });
    const res = await request(app)
      .post('/api/v1/leads/discovery')
      .send({ query: 'medical device distributors Saudi Arabia', maxCandidates: 1 });
    const elapsedMs = Date.now() - started;

    expect(res.status).toBe(202);
    expect(elapsedMs).toBeLessThan(5_000);
    expect(res.body.success).toBe(true);
    expect(res.body.data.task.status).toBe('PENDING');
    expect(res.body.data.task.id).toBeTruthy();
    expect(preview).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      taskId: res.body.data.task.id,
      organizationId: orgA,
      query: 'medical device distributors Saudi Arabia',
      maxCandidates: 1,
    });

    const row = await prisma.leadSearchTask.findUnique({
      where: { id: res.body.data.task.id },
    });
    expect(row?.status).toBe('PENDING');
    expect(row?.organizationId).toBe(orgA);
  });

  it('worker execute moves PENDING → RUNNING → COMPLETED using the existing pipeline', async () => {
    const domain = `queue-ok-${suffix}.test`;
    vi.spyOn(discoveryMod.leadDiscoveryService, 'runDiscoveryPreview').mockResolvedValue(
      sampleDiscovery(domain),
    );

    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'worker complete query',
      maxCandidates: 1,
    });
    expect(created.status).toBe('PENDING');

    const result = await leadDiscoveryRunService.executeLeadDiscoveryTask({
      taskId: created.id,
      organizationId: orgA,
      query: 'worker complete query',
      maxCandidates: 1,
    });
    expect(result.task.status).toBe('COMPLETED');
    expect(result.task.completedAt).toBeTruthy();

    const row = await prisma.leadSearchTask.findUnique({ where: { id: created.id } });
    expect(row?.status).toBe('COMPLETED');
    const company = await prisma.leadCompany.findFirst({
      where: { organizationId: orgA, normalizedDomain: domain },
    });
    expect(company).toBeTruthy();
  });

  it('first worker failure does not permanently FAILED; final attempt does', async () => {
    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'retry then fail query',
      maxCandidates: 1,
    });
    vi.spyOn(discoveryMod.leadDiscoveryService, 'runDiscoveryPreview').mockRejectedValue(
      new Error('firecrawl timeout'),
    );

    await expect(
      processLeadDiscoveryJob({
        id: leadDiscoveryJobId(created.id),
        data: {
          taskId: created.id,
          organizationId: orgA,
          query: 'retry then fail query',
          maxCandidates: 1,
        },
      }),
    ).rejects.toThrow(/firecrawl timeout/);

    const afterFirst = await prisma.leadSearchTask.findUnique({ where: { id: created.id } });
    expect(afterFirst?.status).toBe('RUNNING');

    const markedOnRetry = await handleLeadDiscoveryJobFailed(
      {
        id: leadDiscoveryJobId(created.id),
        data: {
          taskId: created.id,
          organizationId: orgA,
          query: 'retry then fail query',
          maxCandidates: 1,
        },
        attemptsMade: 1,
        opts: { attempts: LEAD_DISCOVERY_JOB_ATTEMPTS },
      },
      new Error('firecrawl timeout'),
    );
    expect(markedOnRetry).toBe(false);
    const stillRunning = await prisma.leadSearchTask.findUnique({ where: { id: created.id } });
    expect(stillRunning?.status).toBe('RUNNING');

    const markedFinal = await handleLeadDiscoveryJobFailed(
      {
        id: leadDiscoveryJobId(created.id),
        data: {
          taskId: created.id,
          organizationId: orgA,
          query: 'retry then fail query',
          maxCandidates: 1,
        },
        attemptsMade: 3,
        opts: { attempts: LEAD_DISCOVERY_JOB_ATTEMPTS },
      },
      new Error('firecrawl timeout'),
    );
    expect(markedFinal).toBe(true);
    const failed = await prisma.leadSearchTask.findUnique({ where: { id: created.id } });
    expect(failed?.status).toBe('FAILED');
    expect(failed?.completedAt).toBeTruthy();
  });

  it('retrying the same task does not create a second SearchTask', async () => {
    const domain = `queue-retry-${suffix}.test`;
    const preview = vi
      .spyOn(discoveryMod.leadDiscoveryService, 'runDiscoveryPreview')
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(sampleDiscovery(domain));

    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'same task retry query',
      maxCandidates: 1,
    });

    await expect(
      leadDiscoveryRunService.executeLeadDiscoveryTask({
        taskId: created.id,
        organizationId: orgA,
        query: 'same task retry query',
        maxCandidates: 1,
      }),
    ).rejects.toThrow(/temporary/);

    const result = await leadDiscoveryRunService.executeLeadDiscoveryTask({
      taskId: created.id,
      organizationId: orgA,
      query: 'same task retry query',
      maxCandidates: 1,
    });
    expect(result.task.id).toBe(created.id);
    expect(result.task.status).toBe('COMPLETED');
    expect(preview).toHaveBeenCalledTimes(2);

    const count = await prisma.leadSearchTask.count({
      where: { organizationId: orgA, prompt: 'same task retry query' },
    });
    expect(count).toBe(1);
  });

  it('GET search-tasks/:taskId is org-scoped', async () => {
    const task = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'status api query',
      maxCandidates: 1,
    });

    const appA = buildLeadsApp({ orgId: orgA });
    const ok = await request(appA).get(`/api/v1/leads/search-tasks/${task.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.task.id).toBe(task.id);
    expect(ok.body.data.task.status).toBe('PENDING');
    expect(ok.body.data.task.prompt).toBe('status api query');
    expect(ok.body.data.task.createdAt).toBeTruthy();

    const appB = buildLeadsApp({ orgId: orgB });
    const denied = await request(appB).get(`/api/v1/leads/search-tasks/${task.id}`);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('ORGANIZATION_MISMATCH');
  });

  it('queue unavailable marks the created task FAILED instead of leaving PENDING', async () => {
    vi.spyOn(queueMod, 'enqueueLeadDiscoveryJob').mockRejectedValue(new Error('ECONNREFUSED'));
    const app = buildLeadsApp({ orgId: orgA });
    const res = await request(app)
      .post('/api/v1/leads/discovery')
      .send({ query: 'queue down query', maxCandidates: 1 });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('LEAD_QUEUE_UNAVAILABLE');

    const row = await prisma.leadSearchTask.findFirst({
      where: { organizationId: orgA, prompt: 'queue down query' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row?.status).toBe('FAILED');
    const meta = row?.metadata as Record<string, unknown>;
    expect(String(meta.error)).toMatch(/ECONNREFUSED/);
  });

  it('execute rejects organization mismatch without creating another task', async () => {
    const task = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'org mismatch execute',
      maxCandidates: 1,
    });
    await expect(
      leadDiscoveryRunService.executeLeadDiscoveryTask({
        taskId: task.id,
        organizationId: orgB,
        query: 'org mismatch execute',
        maxCandidates: 1,
      }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_MISMATCH' });

    const count = await prisma.leadSearchTask.count({
      where: { prompt: 'org mismatch execute' },
    });
    expect(count).toBe(1);
  });
});
