import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { leadsController } from '../src/controllers/leads.controller';
import { AppError } from '../src/utils/errors';
import * as discovery from '../src/services/leads/lead-discovery.service';
import { errorMiddleware } from '../src/middleware/error.middleware';

function buildTestApp(opts: { authed?: boolean; withOrg?: boolean }) {
  const app = express();
  app.use(express.json());
  app.post('/api/v1/leads/discovery-preview', (req, res, next) => {
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
    req.org = { organizationId: 'org1', role: 'owner', membershipId: 'm1' };
    void leadsController.discoveryPreview(req, res, next);
  });
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
});
