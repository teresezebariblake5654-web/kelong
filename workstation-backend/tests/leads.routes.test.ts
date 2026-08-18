import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { leadsController } from '../src/controllers/leads.controller';
import { AppError } from '../src/utils/errors';
import * as discovery from '../src/services/leads/lead-discovery.service';
import * as discoveryRun from '../src/services/leads/lead-discovery-run.service';
import { errorMiddleware } from '../src/middleware/error.middleware';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';

function buildTestApp(opts: { authed?: boolean; withOrg?: boolean; orgId?: string }) {
  const app = express();
  app.use(express.json());

  const mount = (path: string, handler: typeof leadsController.discoveryPreview) => {
    app.post(path, (req, res, next) => {
      if (!opts.authed) {
        next(new AppError(401, '请先登录', 'UNAUTHORIZED'));
        return;
      }
      req.user = {
        id: 'u1',
        username: 'tester',
        email: 't@example.com',
        role: 'user',
        vipLevel: 'free',
        credits: 0,
        status: 'active',
      } as never;
      if (!opts.withOrg) {
        next(new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED'));
        return;
      }
      req.org = {
        organizationId: opts.orgId || 'org1',
        role: 'owner',
        membershipId: 'm1',
      };
      void handler(req, res, next);
    });
  };

  mount('/api/v1/leads/discovery-preview', leadsController.discoveryPreview);
  mount('/api/v1/leads/discovery', leadsController.discovery);
  app.use(errorMiddleware);
  return app;
}

describe('leads discovery-preview routes (no DB)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires auth', async () => {
    const app = buildTestApp({ authed: false });
    const res = await request(app).post('/api/v1/leads/discovery-preview').send({ query: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('requires organization', async () => {
    const app = buildTestApp({ authed: true, withOrg: false });
    const res = await request(app)
      .post('/api/v1/leads/discovery-preview')
      .send({ query: 'medical device distributors' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ORGANIZATION_REQUIRED');
  });

  it('rejects maxCandidates > 5', async () => {
    const app = buildTestApp({ authed: true, withOrg: true });
    const res = await request(app)
      .post('/api/v1/leads/discovery-preview')
      .send({ query: 'medical', maxCandidates: 9 });
    expect(res.status).toBe(400);
  });

  it('returns success envelope when discovery service succeeds', async () => {
    vi.spyOn(discovery.leadDiscoveryService, 'runDiscoveryPreview').mockResolvedValue({
      query: 'medical',
      stats: {
        searchResults: 0,
        uniqueDomains: 0,
        researched: 0,
        successful: 0,
        pagesScraped: 0,
        keeleadVerifyCalls: 0,
      },
      companies: [],
      errors: [],
      durationMs: 1,
    });
    const app = buildTestApp({ authed: true, withOrg: true });
    const res = await request(app)
      .post('/api/v1/leads/discovery-preview')
      .send({ query: 'medical device distributors Saudi Arabia', maxCandidates: 3 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.query).toBe('medical');
  });

  it('discovery-preview does not call persistence/run service', async () => {
    const preview = vi.spyOn(discovery.leadDiscoveryService, 'runDiscoveryPreview').mockResolvedValue({
      query: 'q',
      stats: {
        searchResults: 0,
        uniqueDomains: 0,
        researched: 0,
        successful: 0,
        pagesScraped: 0,
        keeleadVerifyCalls: 0,
      },
      companies: [],
      errors: [],
      durationMs: 1,
    });
    const run = vi.spyOn(discoveryRun.leadDiscoveryRunService, 'startLeadDiscovery');
    const app = buildTestApp({ authed: true, withOrg: true });
    await request(app).post('/api/v1/leads/discovery-preview').send({ query: 'preview only' });
    expect(preview).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});

describe('leads discovery route (enqueue mocked)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 202 with PENDING task and does not wait for discovery stats', async () => {
    vi.spyOn(discoveryRun.leadDiscoveryRunService, 'startLeadDiscovery').mockResolvedValue({
      task: {
        id: 'task1',
        status: 'PENDING',
        query: 'medical',
        prompt: 'medical',
        targetCount: 3,
        startedAt: null,
        completedAt: null,
        createdAt: new Date(),
      },
    });

    const app = buildTestApp({ authed: true, withOrg: true });
    const res = await request(app)
      .post('/api/v1/leads/discovery')
      .send({ query: 'medical', maxCandidates: 3 });
    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.data.task.status).toBe('PENDING');
    expect(res.body.data.task.id).toBe('task1');
    expect(res.body.data.stats).toBeUndefined();
  });

  it('accepts targetCount=20 on POST /discovery', async () => {
    vi.spyOn(discoveryRun.leadDiscoveryRunService, 'startLeadDiscovery').mockResolvedValue({
      task: {
        id: 'task20',
        status: 'PENDING',
        query: 'medical',
        prompt: 'medical',
        targetCount: 20,
        startedAt: null,
        completedAt: null,
        createdAt: new Date(),
      },
    });
    const app = buildTestApp({ authed: true, withOrg: true });
    const res = await request(app)
      .post('/api/v1/leads/discovery')
      .send({ query: 'medical device distributors Saudi Arabia', targetCount: 20 });
    expect(res.status).toBe(202);
    expect(discoveryRun.leadDiscoveryRunService.startLeadDiscovery).toHaveBeenCalledWith(
      expect.objectContaining({ targetCount: 20 }),
    );
  });
});

describe('discovery-preview remains non-writing (db check)', () => {
  const suffix = Date.now();
  let orgId = '';

  beforeAll(async () => {
    await connectDatabase();
    const org = await prisma.organization.create({
      data: { name: `Preview Dry ${suffix}`, slug: `preview-dry-${suffix}` },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    await prisma.leadSourceRecord.deleteMany({ where: { organizationId: orgId } });
    await prisma.leadContact.deleteMany({ where: { organizationId: orgId } });
    await prisma.leadCompany.deleteMany({ where: { organizationId: orgId } });
    await prisma.leadSearchTask.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await disconnectDatabase();
  });

  it('preview path writes zero lead rows', async () => {
    vi.spyOn(discovery.leadDiscoveryService, 'runDiscoveryPreview').mockResolvedValue({
      query: 'dry',
      stats: {
        searchResults: 1,
        uniqueDomains: 1,
        researched: 1,
        successful: 1,
        pagesScraped: 1,
        keeleadVerifyCalls: 0,
      },
      companies: [
        {
          domain: 'dry-preview.test',
          website: 'https://dry-preview.test/',
          search: { title: 't', description: 'd', engine: 'x' },
          candidateKind: 'company_likely',
          researchedPages: ['https://dry-preview.test/'],
          websiteResearch: { title: 't', markdownPreview: 'a@dry-preview.test' },
          contacts: {
            emails: [{ email: 'a@dry-preview.test', verification: null }],
            phones: [],
            linkedin: [],
            facebook: [],
            instagram: [],
          },
          sources: ['searxng'],
        },
      ],
      errors: [],
      durationMs: 1,
    });

    const beforeTasks = await prisma.leadSearchTask.count({ where: { organizationId: orgId } });
    const beforeCompanies = await prisma.leadCompany.count({ where: { organizationId: orgId } });

    const app = buildTestApp({ authed: true, withOrg: true, orgId });
    const res = await request(app)
      .post('/api/v1/leads/discovery-preview')
      .send({ query: 'dry preview' });
    expect(res.status).toBe(200);

    const afterTasks = await prisma.leadSearchTask.count({ where: { organizationId: orgId } });
    const afterCompanies = await prisma.leadCompany.count({ where: { organizationId: orgId } });
    expect(afterTasks).toBe(beforeTasks);
    expect(afterCompanies).toBe(beforeCompanies);
  });
});
