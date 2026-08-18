import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { env } from '../src/config/env';
import { AppError } from '../src/utils/errors';
import { errorMiddleware } from '../src/middleware/error.middleware';
import { mapWithConcurrency } from '../src/utils/map-with-concurrency';
import { leadsController } from '../src/controllers/leads.controller';
import { leadDiscoveryRunService } from '../src/services/leads/lead-discovery-run.service';
import { leadDiscoveryService } from '../src/services/leads/lead-discovery.service';
import { leadScoreService, type LeadScoreLlmCall } from '../src/services/leads/lead-score.service';
import { leadPersistenceService } from '../src/services/leads/lead-persistence.service';
import { getSearchTaskResults } from '../src/services/leads/lead-pool.service';
import { searchTaskResultsQuerySchema } from '../src/services/leads/lead-pool.types';
import { cancelLeadSearchTask } from '../src/services/leads/lead-task-cancel.service';
import { updateLeadTaskProgress } from '../src/services/leads/lead-task-progress.service';
import { getLeadProviderHealth } from '../src/services/leads/lead-provider-health.service';
import { LeadProviderMetricsCollector } from '../src/services/leads/lead-provider-metrics';
import { extractPhonesFromText, isPlaceholderEmail } from '../src/services/leads/lead-phone.service';
import { LeadTaskCancelledError } from '../src/services/leads/lead-task-cancelled.error';
import * as agentMod from '../src/services/leads/agent/acquisition-agent-orchestrator.service';
import { ACQUISITION_AGENT_VERSION } from '../src/services/leads/agent/acquisition-agent.types';
import type { DiscoveryPreviewResult } from '../src/services/leads/lead-discovery.service';
import type { AcquisitionAgentRunResult } from '../src/services/leads/agent/acquisition-agent-orchestrator.service';
import * as queueMod from '../src/queues/lead-discovery.queue';
import {
  enqueueLeadDiscoveryJob,
  leadDiscoveryJobDataSchema,
  resolveJobResearchLimit,
  resolveJobTargetCount,
  type LeadDiscoveryJobData,
} from '../src/queues/lead-discovery.queue';
import {
  handleLeadDiscoveryJobFailed,
  processLeadDiscoveryJob,
} from '../src/workers/lead-discovery.worker';
import {
  isTransientProviderError,
  withProviderRetry,
} from '../src/providers/lead-engines/provider-retry';
import * as searxngMod from '../src/providers/lead-engines/searxng.provider';
import * as firecrawlMod from '../src/providers/lead-engines/firecrawl.provider';
import * as keeleadMod from '../src/providers/lead-engines/keelead.provider';

function validSemantic() {
  return {
    industryScore: 80,
    locationScore: 70,
    businessTypeScore: 60,
    productFitScore: 90,
    companyFitScore: 50,
    reasoning: {
      industry: 'medical',
      location: 'ksa',
      businessType: 'distributor',
      productFit: 'devices',
      companyFit: 'ok',
    },
    evidence: [{ claim: 'contact page' }],
    insufficientEvidence: false,
  };
}

function sampleDiscovery(domain: string, query = 'medical device distributors Saudi Arabia'): DiscoveryPreviewResult {
  return {
    query,
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
          phones: [{ phone: '+966111234567', sourceUrl: `https://${domain}/contact` }],
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

function sampleAgentResult(
  discovery: DiscoveryPreviewResult,
  extra?: Partial<AcquisitionAgentRunResult['agentSummary']>,
): AcquisitionAgentRunResult {
  return {
    discovery,
    agentSummary: {
      version: ACQUISITION_AGENT_VERSION,
      requestedTarget: extra?.requestedTarget ?? 1,
      effectiveResearchLimit: extra?.effectiveResearchLimit ?? 1,
      plan: { queryCount: 3, source: 'fallback' },
      executedQueries: extra?.executedQueries ?? [
        { query: discovery.query, newDomains: discovery.stats.uniqueDomains, hitCount: discovery.stats.searchResults },
      ],
      searchRounds: 1,
      uniqueCandidates: extra?.uniqueCandidates ?? discovery.stats.uniqueDomains,
      stopReason: extra?.stopReason ?? 'TARGET_REACHED',
    },
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
  attach('post', '/api/v1/leads/search-tasks/:taskId/cancel', leadsController.cancelSearchTask);
  attach('get', '/api/v1/leads/search-tasks/:taskId', leadsController.getSearchTask);
  attach('get', '/api/v1/leads/provider-health', leadsController.providerHealth);
  app.use(errorMiddleware);
  return app;
}

const okLlm: LeadScoreLlmCall = async () => ({
  output: validSemantic(),
  provider: 'test',
  model: 'test-model',
  inputTokens: 10,
  outputTokens: 10,
});

describe('targetCount queue semantics', () => {
  it('keeps targetCount=20 on the canonical queue payload', async () => {
    const added: LeadDiscoveryJobData[] = [];
    const fakeQueue = {
      add: vi.fn(async (_name: string, data: LeadDiscoveryJobData) => {
        added.push(data);
        return { id: 'x' };
      }),
    };
    await enqueueLeadDiscoveryJob(
      {
        taskId: 't20',
        organizationId: 'org',
        query: 'medical device distributors Saudi Arabia',
        targetCount: 20,
      },
      fakeQueue,
    );
    expect(added[0].targetCount).toBe(20);
    expect(added[0].researchLimit).toBe(env.leadAgentMaxResearchCompanies);
    expect(added[0].maxCandidates).toBeUndefined();
    expect(resolveJobTargetCount(added[0])).toBe(20);
    expect(resolveJobResearchLimit(added[0])).toBe(env.leadAgentMaxResearchCompanies);
  });

  it('maps legacy maxCandidates to targetCount', async () => {
    const parsed = leadDiscoveryJobDataSchema.parse({
      taskId: 't',
      organizationId: 'o',
      query: 'q',
      maxCandidates: 4,
    });
    expect(resolveJobTargetCount(parsed)).toBe(4);
  });

  it('gives targetCount priority when both fields exist', async () => {
    const parsed = leadDiscoveryJobDataSchema.parse({
      taskId: 't',
      organizationId: 'o',
      query: 'q',
      targetCount: 20,
      maxCandidates: 5,
    });
    expect(resolveJobTargetCount(parsed)).toBe(20);
  });
});

describe('provider retry / concurrency / phone quality / health', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retries SearXNG-style transient errors a limited number of times', async () => {
    let attempts = 0;
    const result = await withProviderRetry({
      provider: 'searxng',
      op: 'search',
      extraAttempts: 2,
      fn: async () => {
        attempts += 1;
        if (attempts < 2) throw new Error('ECONNRESET');
        return ['ok'];
      },
    });
    expect(result).toEqual(['ok']);
    expect(attempts).toBe(2);
  });

  it('retries Firecrawl 5xx then succeeds', async () => {
    let attempts = 0;
    await withProviderRetry({
      provider: 'firecrawl',
      op: 'scrape',
      extraAttempts: 2,
      fn: async () => {
        attempts += 1;
        if (attempts < 2) throw new AppError(503, 'unavailable', 'FIRECRAWL_HTTP_ERROR');
        return { ok: true };
      },
    });
    expect(attempts).toBe(2);
  });

  it('does not retry 4xx parameter errors', async () => {
    let attempts = 0;
    await expect(
      withProviderRetry({
        provider: 'searxng',
        op: 'search',
        extraAttempts: 2,
        fn: async () => {
          attempts += 1;
          throw new AppError(400, 'bad query', 'SEARXNG_BAD_REQUEST');
        },
      }),
    ).rejects.toMatchObject({ code: 'SEARXNG_BAD_REQUEST' });
    expect(attempts).toBe(1);
    expect(isTransientProviderError(new AppError(400, 'bad', 'X'))).toBe(false);
    expect(isTransientProviderError(new AppError(429, 'slow', 'X'))).toBe(true);
  });

  it('records provider metrics without storing HTTP bodies', () => {
    const collector = new LeadProviderMetricsCollector();
    collector.record({ provider: 'searxng', ok: true, retries: 1, durationMs: 12 });
    collector.record({ provider: 'firecrawl', ok: false, retries: 2, durationMs: 40 });
    const snap = collector.snapshot();
    expect(snap.searxng).toEqual({
      requests: 1,
      successes: 1,
      failures: 0,
      retries: 1,
      totalDurationMs: 12,
    });
    expect(snap.firecrawl.failures).toBe(1);
    expect(JSON.stringify(snap)).not.toMatch(/markdown|Authorization|apiKey/i);
  });

  it('keeps research concurrency at or below the Firecrawl hard max', async () => {
    expect(leadDiscoveryService.LEAD_RESEARCH_CONCURRENCY_HARD_MAX).toBe(5);
    expect(leadDiscoveryService.resolveResearchConcurrency()).toBeLessThanOrEqual(5);
    expect(leadDiscoveryService.resolveResearchConcurrency()).toBeLessThanOrEqual(
      env.leadResearchConcurrency || 3,
    );
    const limit = leadDiscoveryService.resolveResearchConcurrency();
    let inflight = 0;
    let max = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), limit, async () => {
      inflight += 1;
      max = Math.max(max, inflight);
      await new Promise((r) => setTimeout(r, 15));
      inflight -= 1;
      return true;
    });
    expect(max).toBeLessThanOrEqual(limit);
    expect(max).toBeLessThanOrEqual(leadDiscoveryService.LEAD_RESEARCH_CONCURRENCY_HARD_MAX);
  });

  it('keeps KeeLead verification concurrency at or below the configured limit', async () => {
    expect(leadDiscoveryService.resolveEmailVerifyConcurrency()).toBeLessThanOrEqual(
      leadDiscoveryService.LEAD_EMAIL_VERIFY_CONCURRENCY_HARD_MAX,
    );
    const limit = leadDiscoveryService.resolveEmailVerifyConcurrency();
    let inflight = 0;
    let max = 0;
    await mapWithConcurrency(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], limit, async () => {
      inflight += 1;
      max = Math.max(max, inflight);
      await new Promise((r) => setTimeout(r, 10));
      inflight -= 1;
    });
    expect(max).toBeLessThanOrEqual(limit);
    expect(max).toBeLessThanOrEqual(env.leadEmailVerifyConcurrency || 5);
  });

  it('filters phone noise and normalizes duplicates from HTML/markdown fixtures', () => {
    const html = `
      <style>.box { width: 120px; color: #ffffff; z-index: 9999; }</style>
      <a href="https://example.com/id/20231227160311">link</a>
      <p>Call +966 11 123 4567 or +966-11-123-4567</p>
      <p>US: +1 415 555 0199 UK: +44 20 7946 0958</p>
      <p>Version 1.2.3 sku 998877665544 v2.1.0</p>
      <p>Dates 2026-08-17 and 2024/01/05</p>
      <img src="banner.png" />
    `;
    const md = `
      Contact: (415) 555-0199
      Also: 415-555-0199
      Local: 555-1234
      CSS: rgb(12, 34, 56)
      Date id: 20231227160311
    `;
    const phones = [
      ...extractPhonesFromText(html, 'https://co.example/contact'),
      ...extractPhonesFromText(md, 'https://co.example/about'),
    ];
    const values = phones.map((p) => p.value);
    const joined = values.join(' ');
    expect(joined).not.toMatch(/20231227160311/);
    expect(joined).not.toMatch(/998877665544/);
    expect(joined).not.toMatch(/20260817/);
    expect(joined).not.toMatch(/20240105/);
    expect(values.some((v) => v.includes('966111234567') || v === '+966111234567')).toBe(true);
    expect(values.some((v) => v.startsWith('+1') || v.includes('4155550199'))).toBe(true);
    expect(values.some((v) => v.startsWith('+44') || v.includes('2079460958'))).toBe(true);
    expect(values.some((v) => v.replace(/\D/g, '') === '5551234' || v.includes('5551234'))).toBe(true);
    const digitKeys = new Set(phones.map((p) => p.value.replace(/\D/g, '')));
    expect(digitKeys.size).toBe(phones.length);
    expect(phones[0].sourceUrl).toBeTruthy();
  });

  it('drops placeholder emails but keeps B2B sales/info/contact/hello/support', () => {
    expect(isPlaceholderEmail('example@example.com')).toBe(true);
    expect(isPlaceholderEmail('email@example.com')).toBe(true);
    expect(isPlaceholderEmail('name@example.com')).toBe(true);
    expect(isPlaceholderEmail('test@example.com')).toBe(true);
    expect(isPlaceholderEmail('user@example.com')).toBe(true);
    expect(isPlaceholderEmail('yourname@example.com')).toBe(true);
    expect(isPlaceholderEmail('foo@localhost')).toBe(true);
    expect(isPlaceholderEmail('test@test.com')).toBe(true);
    expect(isPlaceholderEmail('logo.png@cdn.example')).toBe(true);
    expect(isPlaceholderEmail('sales@acme-med.com')).toBe(false);
    expect(isPlaceholderEmail('info@acme-med.com')).toBe(false);
    expect(isPlaceholderEmail('contact@acme-med.com')).toBe(false);
    expect(isPlaceholderEmail('hello@acme-med.com')).toBe(false);
    expect(isPlaceholderEmail('support@acme-med.com')).toBe(false);
  });

  it('returns provider health UP/DOWN without leaking secrets', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('healthz')) return { ok: true } as Response;
        if (String(url).includes('/v1/health')) return { ok: false, status: 500 } as Response;
        if (String(url).includes('/health')) return { ok: false, status: 500 } as Response;
        return { ok: false, status: 500 } as Response;
      }),
    );
    const health = await getLeadProviderHealth();
    expect(health.searxng.status).toBe('UP');
    expect(health.firecrawl.status).toBe('DOWN');
    expect(JSON.stringify(health)).not.toMatch(/Bearer |apiKey|Authorization/i);
  });

  it('KeeLead timeout still retains the discovered email with null verification', async () => {
    vi.spyOn(searxngMod.searxngProvider, 'searchWebCompanies').mockResolvedValue([
      {
        title: 'Kee',
        url: 'https://kee-timeout.example/',
        domain: 'kee-timeout.example',
        description: 'co',
        engine: 'brave',
      },
    ]);
    vi.spyOn(firecrawlMod.firecrawlProvider, 'mapWebsite').mockResolvedValue([]);
    vi.spyOn(firecrawlMod.firecrawlProvider, 'scrapeWebsite').mockResolvedValue({
      url: 'https://kee-timeout.example/',
      title: 'Home',
      markdown: 'sales@kee-timeout.example',
      metadata: {},
    });
    vi.spyOn(keeleadMod.keeleadProvider, 'verifyEmail').mockRejectedValue(
      new Error('keelead timed out after 15000ms'),
    );
    const result = await leadDiscoveryService.runDiscoveryPreview({
      query: 'kee timeout',
      maxCandidates: 1,
    });
    expect(result.companies[0].contacts.emails[0]?.email).toMatch(/kee-timeout\.example/);
    expect(result.companies[0].contacts.emails[0]?.verification).toBeNull();
  });
});

describe('production hardening (postgres)', () => {
  const suffix = Date.now();
  let orgA = '';
  let orgB = '';

  beforeAll(async () => {
    await connectDatabase();
    const a = await prisma.organization.create({
      data: { name: `Lead Hard A ${suffix}`, slug: `lead-hard-a-${suffix}` },
    });
    const b = await prisma.organization.create({
      data: { name: `Lead Hard B ${suffix}`, slug: `lead-hard-b-${suffix}` },
    });
    orgA = a.id;
    orgB = b.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    const orgIds = [orgA, orgB].filter(Boolean);
    await prisma.leadScore.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.leadSourceRecord.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.leadContact.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.leadCompany.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.leadSearchTask.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await disconnectDatabase();
  });

  it('passes targetCount=20 from worker job into the orchestrator', async () => {
    const run = vi.spyOn(agentMod.acquisitionAgentOrchestrator, 'run').mockResolvedValue(
      sampleAgentResult(sampleDiscovery(`tc20-${suffix}.test`), {
        requestedTarget: 20,
        effectiveResearchLimit: env.leadAgentMaxResearchCompanies,
        stopReason: 'MAX_QUERIES',
      }),
    );
    vi.spyOn(leadScoreService, 'scoreSearchTaskCompanies').mockResolvedValue({
      taskId: 'x',
      scored: 0,
      failed: 0,
      grades: { A: 0, B: 0, C: 0, D: 0 },
      companies: [],
      errors: [],
      totals: { inputTokens: 0, outputTokens: 0, durationMs: 1 },
    });
    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'target 20 query',
      targetCount: 20,
    });
    await processLeadDiscoveryJob({
      id: `lead-discovery-${created.id}`,
      data: {
        taskId: created.id,
        organizationId: orgA,
        query: 'target 20 query',
        targetCount: 20,
      },
    });
    expect(run.mock.calls[0][0].targetCount).toBe(20);
    expect(run.mock.calls[0][1]?.budget?.maxResearchCompanies).toBe(env.leadAgentMaxResearchCompanies);
    const row = await prisma.leadSearchTask.findUnique({ where: { id: created.id } });
    const meta = (row?.metadata ?? {}) as Record<string, unknown>;
    const outcome = meta.outcome as Record<string, unknown>;
    expect(outcome.requestedTarget).toBe(20);
    expect(row?.targetCount).toBe(20);
  });

  it('rejects targetCount above LEAD_MAX_TARGET_COUNT with 4xx and does not clamp', async () => {
    vi.spyOn(queueMod, 'enqueueLeadDiscoveryJob').mockResolvedValue({
      jobId: 'x',
      duplicated: false,
    });
    const app = buildLeadsApp({ orgId: orgA });
    const over = env.leadMaxTargetCount + 1;
    const res = await request(app)
      .post('/api/v1/leads/discovery')
      .send({ query: 'over max target', targetCount: over });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.code).toBe('LEAD_TARGET_COUNT_TOO_LARGE');
    const created = await prisma.leadSearchTask.findFirst({
      where: { organizationId: orgA, prompt: 'over max target' },
    });
    expect(created).toBeNull();
  });

  it('records real progress phases PLANNING → SEARCHING → RESEARCHING → PERSISTING → SCORING', async () => {
    const phases: string[] = [];
    vi.spyOn(agentMod.acquisitionAgentOrchestrator, 'run').mockImplementation(async (_input, deps) => {
      await deps?.onProgress?.({ phase: 'PLANNING' });
      phases.push('PLANNING');
      await deps?.onProgress?.({
        phase: 'SEARCHING',
        searchRound: 1,
        executedQueries: 2,
        uniqueCandidates: 7,
      });
      phases.push('SEARCHING');
      await deps?.onProgress?.({ phase: 'RESEARCHING', researched: 1, uniqueCandidates: 7 });
      phases.push('RESEARCHING');
      return sampleAgentResult(sampleDiscovery(`prog-${suffix}.test`), {
        requestedTarget: 3,
        uniqueCandidates: 7,
        executedQueries: [
          { query: 'q1', newDomains: 4, hitCount: 8 },
          { query: 'q2', newDomains: 3, hitCount: 6 },
        ],
      });
    });
    const originalScore = leadScoreService.scoreSearchTaskCompanies.bind(leadScoreService);
    vi.spyOn(leadScoreService, 'scoreSearchTaskCompanies').mockImplementation(async (input) => {
      phases.push('SCORING_FN');
      return originalScore({ ...input, llmCall: okLlm });
    });
    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'progress query',
      targetCount: 3,
    });
    await leadDiscoveryRunService.executeLeadDiscoveryTask({
      taskId: created.id,
      organizationId: orgA,
      query: 'progress query',
      targetCount: 3,
    });
    expect(phases).toEqual(expect.arrayContaining(['PLANNING', 'SEARCHING', 'RESEARCHING', 'SCORING_FN']));
    const row = await prisma.leadSearchTask.findUnique({ where: { id: created.id } });
    const progress = ((row?.metadata as Record<string, unknown>)?.progress ?? {}) as Record<string, unknown>;
    const counters = (progress.counters ?? {}) as Record<string, unknown>;
    expect(progress.phase).toBe('COMPLETED');
    expect(counters.uniqueCandidates).toBe(7);
    expect(counters.queriesExecuted).toBe(2);
    expect(counters.companiesPersisted).toBe(1);
    expect(counters.candidatesResearched).toBe(1);
    expect(typeof counters.emailsFound).toBe('number');
    expect(counters.emailsFound).toBe(1);
    expect(progress).not.toHaveProperty('percent');
    expect(JSON.stringify(progress)).not.toMatch(/percent|percentage/i);
  });

  it('merges progress without dropping existing metadata keys', async () => {
    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'progress merge query',
      targetCount: 20,
    });
    await updateLeadTaskProgress({
      taskId: created.id,
      organizationId: orgA,
      patch: { phase: 'QUEUED' },
      extraMetadata: {
        requestedTarget: 20,
        effectiveResearchLimit: 8,
        executedQueries: [{ query: 'q1', newDomains: 2, hitCount: 4 }],
        searchRounds: 1,
        uniqueCandidates: 4,
        stopReason: 'NO_NEW_DOMAINS',
      },
    });
    await updateLeadTaskProgress({
      taskId: created.id,
      organizationId: orgA,
      patch: {
        phase: 'SEARCHING',
        executedQueries: 3,
        uniqueCandidates: 9,
      },
    });
    const row = await prisma.leadSearchTask.findUnique({ where: { id: created.id } });
    const meta = (row?.metadata ?? {}) as Record<string, unknown>;
    const progress = (meta.progress ?? {}) as Record<string, unknown>;
    const counters = (progress.counters ?? {}) as Record<string, unknown>;
    expect(meta.requestedTarget).toBe(20);
    expect(meta.effectiveResearchLimit).toBe(8);
    expect(meta.searchRounds).toBe(1);
    expect(meta.stopReason).toBe('NO_NEW_DOMAINS');
    expect(Array.isArray(meta.executedQueries)).toBe(true);
    expect(meta.uniqueCandidates).toBe(4);
    expect(progress.phase).toBe('SEARCHING');
    expect(counters.queriesExecuted).toBe(3);
    expect(counters.uniqueCandidates).toBe(9);
  });

  it('cancels PENDING tasks to CANCELLED without using FAILED', async () => {
    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'pending cancel',
      targetCount: 3,
    });
    const result = await cancelLeadSearchTask({
      organizationId: orgA,
      taskId: created.id,
      removeQueuedJob: async () => true,
    });
    expect(result.status).toBe('CANCELLED');
    const row = await prisma.leadSearchTask.findUnique({ where: { id: created.id } });
    expect(row?.status).toBe('CANCELLED');
    expect(row?.cancelledAt).toBeTruthy();
    expect(row?.status).not.toBe('FAILED');
  });

  it('cooperatively cancels a RUNNING task and does not trigger ordinary retry', async () => {
    vi.spyOn(agentMod.acquisitionAgentOrchestrator, 'run').mockImplementation(async (_input, deps) => {
      for (let i = 0; i < 40; i += 1) {
        await deps?.assertNotCancelled?.();
        await new Promise((r) => setTimeout(r, 25));
      }
      return sampleAgentResult(sampleDiscovery(`run-cancel-${suffix}.test`));
    });
    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'running cancel',
      targetCount: 3,
    });
    const exec = leadDiscoveryRunService.executeLeadDiscoveryTask({
      taskId: created.id,
      organizationId: orgA,
      query: 'running cancel',
      targetCount: 3,
    });
    await new Promise((r) => setTimeout(r, 40));
    await prisma.leadSearchTask.update({
      where: { id: created.id },
      data: { status: 'RUNNING', cancelRequestedAt: new Date() },
    });
    const out = await exec;
    expect(out.task.status).toBe('CANCELLED');
    const row = await prisma.leadSearchTask.findUnique({ where: { id: created.id } });
    expect(row?.status).toBe('CANCELLED');
    expect(row?.status).not.toBe('FAILED');

    await expect(
      processLeadDiscoveryJob({
        id: `lead-discovery-${created.id}`,
        data: {
          taskId: created.id,
          organizationId: orgA,
          query: 'running cancel',
          targetCount: 3,
        },
      }),
    ).resolves.toBeUndefined();

    const marked = await handleLeadDiscoveryJobFailed(
      {
        id: `lead-discovery-${created.id}`,
        data: {
          taskId: created.id,
          organizationId: orgA,
          query: 'running cancel',
          targetCount: 3,
        },
        attemptsMade: 1,
        opts: { attempts: 3 },
      },
      new LeadTaskCancelledError(),
    );
    expect(marked).toBe(true);
    const after = await prisma.leadSearchTask.findUnique({ where: { id: created.id } });
    expect(after?.status).toBe('CANCELLED');
  });

  it('does not retry cancelled jobs through the ordinary BullMQ failure path', async () => {
    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'cancel no retry',
      targetCount: 1,
    });
    await prisma.leadSearchTask.update({
      where: { id: created.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelRequestedAt: new Date() },
    });
    const fail = vi.spyOn(leadPersistenceService, 'failSearchTask');
    const marked = await handleLeadDiscoveryJobFailed(
      {
        id: `lead-discovery-${created.id}`,
        data: {
          taskId: created.id,
          organizationId: orgA,
          query: 'cancel no retry',
          targetCount: 1,
        },
        attemptsMade: 1,
        opts: { attempts: 3 },
      },
      new LeadTaskCancelledError(),
    );
    expect(marked).toBe(true);
    expect(fail).not.toHaveBeenCalled();
    const row = await prisma.leadSearchTask.findUnique({ where: { id: created.id } });
    expect(row?.status).toBe('CANCELLED');
  });

  it('does not overwrite CANCELLED with COMPLETED or FAILED', async () => {
    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'cancel overwrite guard',
      targetCount: 1,
    });
    await prisma.leadSearchTask.update({
      where: { id: created.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelRequestedAt: new Date() },
    });
    const completed = await leadPersistenceService.completeSearchTask({
      taskId: created.id,
      discovery: sampleDiscovery(`cancel-over-${suffix}.test`),
      persistStats: {
        savedCompanies: 1,
        createdCompanies: 1,
        updatedCompanies: 0,
        createdContacts: 0,
        updatedContacts: 0,
        sourceRecords: 0,
      },
    });
    expect(completed.status).toBe('CANCELLED');
    const failed = await leadPersistenceService.failSearchTask({
      taskId: created.id,
      error: new Error('should not fail a cancelled task'),
    });
    expect(failed?.status).toBe('CANCELLED');
    const row = await prisma.leadSearchTask.findUnique({ where: { id: created.id } });
    expect(row?.status).toBe('CANCELLED');
  });

  it('repeat cancel is idempotent', async () => {
    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'idempotent cancel',
      targetCount: 1,
    });
    await cancelLeadSearchTask({
      organizationId: orgA,
      taskId: created.id,
      removeQueuedJob: async () => true,
    });
    const second = await cancelLeadSearchTask({
      organizationId: orgA,
      taskId: created.id,
      removeQueuedJob: async () => true,
    });
    expect(second.status).toBe('CANCELLED');
  });

  it('cannot cancel a COMPLETED task', async () => {
    vi.spyOn(agentMod.acquisitionAgentOrchestrator, 'run').mockResolvedValue(
      sampleAgentResult(sampleDiscovery(`done-${suffix}.test`)),
    );
    vi.spyOn(leadScoreService, 'scoreSearchTaskCompanies').mockResolvedValue({
      taskId: 'x',
      scored: 1,
      failed: 0,
      grades: { A: 0, B: 1, C: 0, D: 0 },
      companies: [],
      errors: [],
      totals: { inputTokens: 0, outputTokens: 0, durationMs: 1 },
    });
    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'completed cancel',
      targetCount: 1,
    });
    await leadDiscoveryRunService.executeLeadDiscoveryTask({
      taskId: created.id,
      organizationId: orgA,
      query: 'completed cancel',
      targetCount: 1,
    });
    await expect(
      cancelLeadSearchTask({ organizationId: orgA, taskId: created.id }),
    ).rejects.toMatchObject({ code: 'LEAD_TASK_ALREADY_COMPLETED' });
  });

  it('org A cannot cancel org B task', async () => {
    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgB,
      query: 'org isolation cancel',
      targetCount: 1,
    });
    await expect(
      cancelLeadSearchTask({ organizationId: orgA, taskId: created.id }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_MISMATCH' });
  });

  it('auto-scores after discovery without writing fake 0 on success', async () => {
    vi.spyOn(agentMod.acquisitionAgentOrchestrator, 'run').mockResolvedValue(
      sampleAgentResult(sampleDiscovery(`score-ok-${suffix}.test`)),
    );
    const original = leadScoreService.scoreSearchTaskCompanies.bind(leadScoreService);
    vi.spyOn(leadScoreService, 'scoreSearchTaskCompanies').mockImplementation((input) =>
      original({ ...input, llmCall: okLlm }),
    );
    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'auto score query',
      targetCount: 1,
    });
    const result = await leadDiscoveryRunService.executeLeadDiscoveryTask({
      taskId: created.id,
      organizationId: orgA,
      query: 'auto score query',
      targetCount: 1,
    });
    expect(result.task.status).toBe('COMPLETED');
    const scores = await prisma.leadScore.findMany({ where: { searchTaskId: created.id } });
    expect(scores.length).toBe(1);
    expect(scores[0].overallScore).toBeGreaterThan(0);
  });

  it('partial scoring failure keeps discovery data and does not write fake 0', async () => {
    vi.spyOn(agentMod.acquisitionAgentOrchestrator, 'run').mockResolvedValue(
      sampleAgentResult(sampleDiscovery(`score-fail-${suffix}.test`)),
    );
    vi.spyOn(leadScoreService, 'scoreSearchTaskCompanies').mockResolvedValue({
      taskId: 'x',
      scored: 0,
      failed: 1,
      grades: { A: 0, B: 0, C: 0, D: 0 },
      companies: [],
      errors: [{ companyId: 'c1', domain: `score-fail-${suffix}.test`, code: 'ICP_SCORE_FAILED', message: 'llm down' }],
      totals: { inputTokens: 0, outputTokens: 0, durationMs: 1 },
    });
    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'partial score query',
      targetCount: 1,
    });
    const result = await leadDiscoveryRunService.executeLeadDiscoveryTask({
      taskId: created.id,
      organizationId: orgA,
      query: 'partial score query',
      targetCount: 1,
    });
    expect(result.task.status).toBe('COMPLETED');
    const company = await prisma.leadCompany.findFirst({
      where: { organizationId: orgA, normalizedDomain: `score-fail-${suffix}.test` },
    });
    expect(company).toBeTruthy();
    const scores = await prisma.leadScore.findMany({ where: { searchTaskId: created.id } });
    expect(scores).toHaveLength(0);
    expect(scores.some((s) => s.overallScore === 0)).toBe(false);
    const meta = (await prisma.leadSearchTask.findUnique({ where: { id: created.id } }))
      ?.metadata as Record<string, unknown>;
    expect((meta.scoring as { status?: string })?.status).toMatch(/FAILED|PARTIAL/);
    const pool = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: created.id,
      query: searchTaskResultsQuerySchema.parse({ page: 1, pageSize: 20 }),
    });
    expect(pool.summary.grades.UNSCORED).toBeGreaterThanOrEqual(1);
    expect(pool.companies.some((c) => c.score == null)).toBe(true);
  });

  it('stores outcome when requested target is not reached', async () => {
    vi.spyOn(agentMod.acquisitionAgentOrchestrator, 'run').mockResolvedValue(
      sampleAgentResult(sampleDiscovery(`short-${suffix}.test`), {
        requestedTarget: 10,
        effectiveResearchLimit: 3,
        stopReason: 'NO_NEW_DOMAINS',
      }),
    );
    vi.spyOn(leadScoreService, 'scoreSearchTaskCompanies').mockResolvedValue({
      taskId: 'x',
      scored: 1,
      failed: 0,
      grades: { A: 0, B: 1, C: 0, D: 0 },
      companies: [],
      errors: [],
      totals: { inputTokens: 0, outputTokens: 0, durationMs: 1 },
    });
    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'outcome short query',
      targetCount: 10,
    });
    await leadDiscoveryRunService.executeLeadDiscoveryTask({
      taskId: created.id,
      organizationId: orgA,
      query: 'outcome short query',
      targetCount: 10,
    });
    const row = await prisma.leadSearchTask.findUnique({ where: { id: created.id } });
    const outcome = (row?.metadata as Record<string, unknown>).outcome as Record<string, unknown>;
    expect(outcome.requestedTarget).toBe(10);
    expect(outcome.acquiredCompanies).toBe(1);
    expect(outcome.targetReached).toBe(false);
    expect(outcome.stopReason).toBe('NO_NEW_DOMAINS');
    expect(outcome.effectiveResearchLimit).toBe(3);
    expect(row?.status).toBe('COMPLETED');
  });

  it('stores providerMetrics on completed tasks', async () => {
    vi.spyOn(agentMod.acquisitionAgentOrchestrator, 'run').mockResolvedValue(
      sampleAgentResult(sampleDiscovery(`metrics-${suffix}.test`)),
    );
    vi.spyOn(leadScoreService, 'scoreSearchTaskCompanies').mockResolvedValue({
      taskId: 'x',
      scored: 0,
      failed: 0,
      grades: { A: 0, B: 0, C: 0, D: 0 },
      companies: [],
      errors: [],
      totals: { inputTokens: 0, outputTokens: 0, durationMs: 1 },
    });
    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'metrics query',
      targetCount: 1,
    });
    await leadDiscoveryRunService.executeLeadDiscoveryTask({
      taskId: created.id,
      organizationId: orgA,
      query: 'metrics query',
      targetCount: 1,
    });
    const meta = (await prisma.leadSearchTask.findUnique({ where: { id: created.id } }))
      ?.metadata as Record<string, unknown>;
    expect(meta.providerMetrics).toBeTruthy();
    expect(JSON.stringify(meta.providerMetrics)).not.toMatch(/markdown|Authorization/i);
  });

  it('enforces org active task limit without affecting the other org', async () => {
    vi.spyOn(queueMod, 'enqueueLeadDiscoveryJob').mockResolvedValue({
      jobId: 'x',
      duplicated: false,
    });
    const active = await prisma.leadSearchTask.count({
      where: { organizationId: orgA, status: { in: ['PENDING', 'RUNNING'] } },
    });
    const need = Math.max(0, env.leadMaxActiveTasksPerOrg - active);
    for (let i = 0; i < need; i += 1) {
      await leadDiscoveryRunService.createLeadDiscoveryTask({
        organizationId: orgA,
        query: `limit a${i}`,
        targetCount: 1,
      });
    }
    const appA = buildLeadsApp({ orgId: orgA });
    const blocked = await request(appA)
      .post('/api/v1/leads/discovery')
      .send({ query: 'limit a-overflow', targetCount: 1 });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('LEAD_ORG_ACTIVE_TASK_LIMIT');

    const appB = buildLeadsApp({ orgId: orgB });
    const ok = await request(appB)
      .post('/api/v1/leads/discovery')
      .send({ query: 'limit b1', targetCount: 1 });
    expect(ok.status).toBe(202);
  });

  it('GET task returns safe progress without full metadata', async () => {
    const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'status progress query',
      targetCount: 3,
    });
    const app = buildLeadsApp({ orgId: orgA });
    const res = await request(app).get(`/api/v1/leads/search-tasks/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.task.status).toBe('PENDING');
    expect(res.body.data.task).toHaveProperty('progress');
    expect(JSON.stringify(res.body)).not.toMatch(/systemPrompt|chain-of-thought|apiKey/i);
  });

  it('GET provider-health requires org and does not 500 when a provider is DOWN', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('healthz') || String(url) === `${env.searxngBaseUrl.replace(/\/$/, '')}/`) {
          return { ok: true } as Response;
        }
        return { ok: false, status: 503 } as Response;
      }),
    );
    const app = buildLeadsApp({ orgId: orgA });
    const res = await request(app).get('/api/v1/leads/provider-health');
    expect(res.status).toBe(200);
    expect(['UP', 'DOWN']).toContain(res.body.data.searxng.status);
    expect(['UP', 'DOWN']).toContain(res.body.data.firecrawl.status);
    expect(JSON.stringify(res.body)).not.toMatch(/Bearer |apiKey/i);
  });
});
