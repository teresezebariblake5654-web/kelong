import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { env } from '../src/config/env';
import type { SearxngSearchHit } from '../src/providers/lead-engines/lead-provider.types';
import * as keeleadMod from '../src/providers/lead-engines/keelead.provider';
import * as firecrawlMod from '../src/providers/lead-engines/firecrawl.provider';
import {
  evaluateAcquisitionProgress,
  buildDeterministicEvaluatorDecision,
} from '../src/services/leads/agent/acquisition-agent-evaluator.service';
import {
  planAcquisitionQueries,
  buildFallbackQueryPlan,
  dedupePlannedQueries,
  PLANNER_SYSTEM_PROMPT,
} from '../src/services/leads/agent/acquisition-agent-planner.service';
import {
  mergeHitsIntoPool,
  runAcquisitionAgent,
  toResearchHits,
} from '../src/services/leads/agent/acquisition-agent-orchestrator.service';
import { rankAcquisitionCandidates } from '../src/services/leads/agent/acquisition-agent-ranking';
import {
  ACQUISITION_AGENT_VERSION,
  type AgentCandidate,
  type AcquisitionPlan,
  type EvaluatorDecision,
} from '../src/services/leads/agent/acquisition-agent.types';
import { leadDiscoveryService } from '../src/services/leads/lead-discovery.service';
import type { DiscoveryPreviewCompany } from '../src/services/leads/lead-discovery.service';
import { leadDiscoveryRunService } from '../src/services/leads/lead-discovery-run.service';
import { leadPersistenceService } from '../src/services/leads/lead-persistence.service';

function hit(domain: string, title?: string, description?: string): SearxngSearchHit {
  return {
    title: title ?? domain,
    url: `https://${domain}/`,
    domain,
    description: description ?? `${title ?? domain} medical distributor Saudi Arabia`,
    engine: 'brave',
    searchQuery: 'q-alpha',
    searchQueries: ['q-alpha'],
  };
}

function planOf(queries: string[]): AcquisitionPlan {
  return {
    interpretation: {
      industries: ['medical devices'],
      businessTypes: ['distributor'],
      productKeywords: ['medical device'],
      locationKeywords: ['Saudi Arabia', 'KSA'],
      exclusions: [],
    },
    queries: queries.map((query, i) => ({
      query,
      rationale: `q${i + 1}`,
      priority: i + 1,
    })),
  };
}

function researched(domain: string, extras?: Partial<DiscoveryPreviewCompany>): DiscoveryPreviewCompany {
  return {
    domain,
    website: `https://${domain}/`,
    search: {
      title: domain,
      description: 'Distributor',
      engine: 'brave',
      query: 'q1',
      queries: ['q1'],
    },
    candidateKind: 'company_likely',
    researchedPages: [`https://${domain}/`],
    websiteResearch: { title: domain, markdownPreview: `sales@${domain}` },
    contacts: {
      emails: [{ email: `sales@${domain}`, sourceUrl: `https://${domain}/contact`, verification: { status: 'valid', score: 80 } }],
      phones: [],
      linkedin: [],
      facebook: [],
      instagram: [],
    },
    sources: ['searxng', 'firecrawl'],
    ...extras,
  };
}

const defaultBudget = {
  maxSearchRounds: 3,
  maxQueriesPerRound: 5,
  maxTotalQueries: 10,
  maxResearchCompanies: 20,
  llmTimeoutMs: 1000,
};

describe('acquisition planner', () => {
  it('returns a structured query plan from valid LLM JSON', async () => {
    const result = await planAcquisitionQueries({
      prompt: '帮我找沙特心外科医疗器械经销商',
      targetCount: 10,
      llmCall: async () => ({
        interpretation: {
          industries: ['medical devices'],
          businessTypes: ['distributor', 'importer'],
          productKeywords: ['cardiovascular', 'cardiac surgery'],
          locationKeywords: ['Saudi Arabia', 'KSA'],
          exclusions: [],
        },
        queries: [
          { query: 'cardiovascular device distributor Saudi Arabia', rationale: 'product+geo', priority: 1 },
          { query: 'cardiac surgery equipment supplier KSA', rationale: 'specialty', priority: 2 },
          { query: 'medical device importer cardiovascular Saudi Arabia', rationale: 'importer', priority: 3 },
        ],
      }),
    });
    expect(result.source).toBe('llm');
    expect(result.plan.queries.length).toBeGreaterThanOrEqual(3);
    expect(result.plan.queries.map((q) => q.query).join(' ')).toMatch(/cardiovascular|cardiac/i);
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/meaningfully different/i);
  });

  it('repairs malformed JSON then falls back deterministically', async () => {
    let calls = 0;
    const result = await planAcquisitionQueries({
      prompt: 'medical device distributors Saudi Arabia',
      targetCount: 3,
      llmCall: async () => {
        calls += 1;
        if (calls === 1) return 'not-json';
        return { queries: [{ query: 'only one', rationale: 'x', priority: 1 }] };
      },
    });
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(result.source).toBe('fallback');
    expect(result.plan.queries.length).toBeGreaterThanOrEqual(3);
    expect(result.plan.queries[0].query).toBe('medical device distributors Saudi Arabia');
  });

  it('dedupes near-identical queries', () => {
    const deduped = dedupePlannedQueries([
      { query: 'Medical Distributor Saudi Arabia', rationale: 'a', priority: 1 },
      { query: 'medical   distributor saudi arabia', rationale: 'b', priority: 2 },
      { query: 'cardiac surgery supplier KSA', rationale: 'c', priority: 3 },
    ]);
    expect(deduped).toHaveLength(2);
  });

  it('fallback expands rather than cloning the original prompt', () => {
    const plan = buildFallbackQueryPlan('cardiovascular medical device distributors Saudi Arabia');
    const blob = plan.queries.map((q) => q.query).join(' | ').toLowerCase();
    expect(blob).toMatch(/importer|supplier|ksa|cardiac/);
    expect(new Set(plan.queries.map((q) => q.query.toLowerCase())).size).toBe(plan.queries.length);
  });
});

describe('acquisition evaluator', () => {
  it('asks to continue with supplemental queries when below target', async () => {
    const result = await evaluateAcquisitionProgress({
      requestedTarget: 10,
      uniqueCandidateCount: 2,
      researchedCount: 0,
      queryHistory: ['q1'],
      topDomains: ['a.test'],
      domainSignals: { companyLikely: 2, directoryLikely: 0 },
      llmCall: async () => ({
        enoughCandidates: false,
        shouldContinueSearching: true,
        reason: 'need more specialty queries',
        supplementalQueries: ['cardiac surgery distributor KSA', 'q1'],
      }),
    });
    expect(result.source).toBe('llm');
    expect(result.decision.shouldContinueSearching).toBe(true);
    expect(result.decision.supplementalQueries).toEqual(['cardiac surgery distributor KSA']);
  });

  it('falls back when LLM JSON is invalid', async () => {
    const result = await evaluateAcquisitionProgress({
      requestedTarget: 5,
      uniqueCandidateCount: 1,
      researchedCount: 0,
      queryHistory: [],
      topDomains: [],
      domainSignals: { companyLikely: 1, directoryLikely: 0 },
      llmCall: async () => 'nope',
    });
    expect(result.source).toBe('fallback');
    expect(result.decision.enoughCandidates).toBe(false);
    expect(buildDeterministicEvaluatorDecision({
      requestedTarget: 5,
      uniqueCandidateCount: 5,
      researchedCount: 0,
      queryHistory: [],
      topDomains: [],
      domainSignals: { companyLikely: 5, directoryLikely: 0 },
    }).enoughCandidates).toBe(true);
  });
});

describe('candidate pool + ranking', () => {
  it('dedupes the same domain across queries and keeps provenance', () => {
    const pool = new Map<string, AgentCandidate>();
    const first = mergeHitsIntoPool(pool, 'q1', [hit('acme.test', 'Acme')]);
    const second = mergeHitsIntoPool(pool, 'q2', [hit('acme.test', 'Acme Med'), hit('other.test', 'Other')]);
    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(pool.size).toBe(2);
    const acme = pool.get('acme.test')!;
    expect(acme.provenances.map((p) => p.query)).toEqual(['q1', 'q2']);
    expect(toResearchHits([acme])[0].searchQueries).toEqual(['q1', 'q2']);
  });

  it('deprioritizes directory candidates for research', () => {
    const pool = new Map<string, AgentCandidate>();
    mergeHitsIntoPool(pool, 'q', [
      {
        title: 'Saudi Distributors Directory',
        url: 'https://ensun.io/distributors/saudi',
        domain: 'ensun.io',
        description: 'directory of distributors',
        engine: 'x',
      },
      hit('and-medical.com', 'And Medical', 'cardiac surgery distributor Riyadh'),
    ]);
    const ranked = rankAcquisitionCandidates([...pool.values()], {
      industries: ['medical devices'],
      businessTypes: ['distributor'],
      productKeywords: ['cardiac'],
      locationKeywords: ['Saudi Arabia'],
      exclusions: [],
    });
    expect(ranked[0].normalizedDomain).toBe('and-medical.com');
    expect(ranked[ranked.length - 1].normalizedDomain).toBe('ensun.io');
  });
});

describe('acquisition orchestrator loop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('executes supplemental queries when evaluator asks to continue', async () => {
    const discovered: string[] = [];
    const result = await runAcquisitionAgent(
      {
        taskId: 't-eval',
        organizationId: 'org',
        prompt: 'medical device distributors Saudi Arabia',
        targetCount: 5,
      },
      {
        budget: { ...defaultBudget, maxQueriesPerRound: 1, maxTotalQueries: 5 },
        plan: async () => ({ plan: planOf(['q1']), source: 'llm' }),
        evaluate: async () => ({
          decision: {
            enoughCandidates: false,
            shouldContinueSearching: true,
            reason: 'need more',
            supplementalQueries: ['q-supplemental'],
          } satisfies EvaluatorDecision,
          source: 'llm',
        }),
        discover: async ({ query }) => {
          discovered.push(query);
          if (query === 'q-supplemental') {
            return { query, hits: [hit('new.test')], errors: [] };
          }
          return { query, hits: [hit('one.test')], errors: [] };
        },
        research: async ({ hits }) => ({
          companies: hits.map((h) => researched(h.domain)),
          researched: hits.length,
          successful: hits.length,
          pagesScraped: hits.length,
          keeleadVerifyCalls: 0,
          errors: [],
        }),
      },
    );
    expect(discovered).toContain('q-supplemental');
    expect(result.agentSummary.uniqueCandidates).toBeGreaterThanOrEqual(2);
  });

  it('stops after the plan when the unique pool meets target', async () => {
    let evalCalls = 0;
    const discovered: string[] = [];
    const result = await runAcquisitionAgent(
      {
        taskId: 't-target',
        organizationId: 'org',
        prompt: 'medical',
        targetCount: 2,
      },
      {
        budget: defaultBudget,
        plan: async () => ({
          plan: planOf(['q1', 'q2', 'q3']),
          source: 'llm',
        }),
        evaluate: async () => {
          evalCalls += 1;
          return {
            decision: {
              enoughCandidates: false,
              shouldContinueSearching: true,
              reason: 'should not run',
              supplementalQueries: ['should-not-run'],
            },
            source: 'llm',
          };
        },
        discover: async ({ query }) => {
          discovered.push(query);
          return {
            query,
            hits: [hit(`${query}-a.test`), hit(`${query}-b.test`)],
            errors: [],
          };
        },
        research: async ({ hits }) => ({
          companies: hits.map((h) => researched(h.domain)),
          researched: hits.length,
          successful: hits.length,
          pagesScraped: 0,
          keeleadVerifyCalls: 0,
          errors: [],
        }),
      },
    );
    expect(discovered).toEqual(['q1', 'q2', 'q3']);
    expect(discovered).not.toContain('should-not-run');
    expect(evalCalls).toBe(0);
    expect(result.agentSummary.stopReason).toBe('TARGET_REACHED');
  });

  it('hard-stops at max total queries', async () => {
    const discovered: string[] = [];
    const result = await runAcquisitionAgent(
      {
        taskId: 't-maxq',
        organizationId: 'org',
        prompt: 'medical',
        targetCount: 100,
      },
      {
        budget: { ...defaultBudget, maxTotalQueries: 2, maxQueriesPerRound: 5, maxSearchRounds: 5 },
        plan: async () => ({ plan: planOf(['q1', 'q2', 'q3', 'q4']), source: 'llm' }),
        evaluate: async () => ({
          decision: {
            enoughCandidates: false,
            shouldContinueSearching: true,
            reason: 'continue',
            supplementalQueries: ['q5'],
          },
          source: 'llm',
        }),
        discover: async ({ query }) => {
          discovered.push(query);
          return { query, hits: [hit(`${query}.test`)], errors: [] };
        },
        research: async ({ hits }) => ({
          companies: hits.map((h) => researched(h.domain)),
          researched: hits.length,
          successful: 0,
          pagesScraped: 0,
          keeleadVerifyCalls: 0,
          errors: [],
        }),
      },
    );
    expect(discovered).toHaveLength(2);
    expect(result.agentSummary.stopReason).toBe('MAX_QUERIES');
  });

  it('stops after consecutive rounds with no new domains', async () => {
    const discovered: string[] = [];
    const result = await runAcquisitionAgent(
      {
        taskId: 't-empty',
        organizationId: 'org',
        prompt: 'medical',
        targetCount: 50,
      },
      {
        budget: { ...defaultBudget, maxQueriesPerRound: 1, maxSearchRounds: 5, maxTotalQueries: 10 },
        plan: async () => ({ plan: planOf(['q1', 'q2', 'q3', 'q4']), source: 'llm' }),
        evaluate: async () => ({
          decision: {
            enoughCandidates: false,
            shouldContinueSearching: false,
            reason: 'unused',
            supplementalQueries: [],
          },
          source: 'llm',
        }),
        discover: async ({ query }) => {
          discovered.push(query);
          return { query, hits: [hit('same.test')], errors: [] };
        },
        research: async ({ hits }) => ({
          companies: hits.map((h) => researched(h.domain)),
          researched: hits.length,
          successful: 0,
          pagesScraped: 0,
          keeleadVerifyCalls: 0,
          errors: [],
        }),
      },
    );
    expect(discovered).toEqual(['q1', 'q2', 'q3']);
    expect(result.agentSummary.stopReason).toBe('NO_NEW_DOMAINS');
    expect(result.discovery.stats.uniqueDomains).toBe(1);
  });

  it('does not let LLM exceed the research hard limit', async () => {
    let researchedCount = 0;
    const result = await runAcquisitionAgent(
      {
        taskId: 't-limit',
        organizationId: 'org',
        prompt: 'medical',
        targetCount: 100,
      },
      {
        budget: { ...defaultBudget, maxResearchCompanies: 2, maxTotalQueries: 1 },
        plan: async () => ({ plan: planOf(['q1']), source: 'llm' }),
        evaluate: async () => ({
          decision: {
            enoughCandidates: true,
            shouldContinueSearching: false,
            reason: 'stop',
            supplementalQueries: [],
          },
          source: 'llm',
        }),
        discover: async ({ query }) => ({
          query,
          hits: ['a.test', 'b.test', 'c.test', 'd.test', 'e.test'].map((d) => hit(d)),
          errors: [],
        }),
        research: async ({ hits, maxCompanies }) => {
          researchedCount = hits.length;
          expect(hits.length).toBeLessThanOrEqual(2);
          expect(maxCompanies).toBe(2);
          return {
            companies: hits.map((h) => researched(h.domain)),
            researched: hits.length,
            successful: hits.length,
            pagesScraped: 0,
            keeleadVerifyCalls: 0,
            errors: [],
          };
        },
      },
    );
    expect(researchedCount).toBe(2);
    expect(result.agentSummary.effectiveResearchLimit).toBe(2);
    expect(result.agentSummary.requestedTarget).toBe(100);
    expect(result.discovery.stats.researched).toBe(2);
  });

  it('continues other queries when a single SearXNG query fails', async () => {
    const result = await runAcquisitionAgent(
      {
        taskId: 't-search-err',
        organizationId: 'org',
        prompt: 'medical',
        targetCount: 1,
      },
      {
        budget: { ...defaultBudget, maxTotalQueries: 2, maxQueriesPerRound: 2 },
        plan: async () => ({ plan: planOf(['bad-q', 'good-q']), source: 'llm' }),
        evaluate: async () => ({
          decision: {
            enoughCandidates: true,
            shouldContinueSearching: false,
            reason: 'ok',
            supplementalQueries: [],
          },
          source: 'llm',
        }),
        discover: async ({ query }) => {
          if (query === 'bad-q') {
            return {
              query,
              hits: [],
              errors: [{ provider: 'searxng', code: 'SEARXNG_HTTP_ERROR', message: '502' }],
            };
          }
          return { query, hits: [hit('ok.test')], errors: [] };
        },
        research: async ({ hits }) => ({
          companies: hits.map((h) => researched(h.domain)),
          researched: hits.length,
          successful: hits.length,
          pagesScraped: 0,
          keeleadVerifyCalls: 0,
          errors: [],
        }),
      },
    );
    expect(result.discovery.stats.uniqueDomains).toBe(1);
    expect(result.discovery.errors.some((e) => e.code === 'SEARXNG_HTTP_ERROR')).toBe(true);
    expect(result.discovery.companies[0]?.domain).toBe('ok.test');
  });

  it('does not double-count unique domains or re-research the same domain', async () => {
    let researchCalls = 0;
    const result = await runAcquisitionAgent(
      {
        taskId: 't-counts',
        organizationId: 'org',
        prompt: 'medical',
        targetCount: 1,
      },
      {
        budget: { ...defaultBudget, maxTotalQueries: 2, maxQueriesPerRound: 2 },
        plan: async () => ({ plan: planOf(['q1', 'q2']), source: 'llm' }),
        evaluate: async () => ({
          decision: {
            enoughCandidates: true,
            shouldContinueSearching: false,
            reason: 'ok',
            supplementalQueries: [],
          },
          source: 'llm',
        }),
        discover: async ({ query }) => ({
          query,
          hits: [hit('same.test'), hit('same.test')],
          errors: [],
        }),
        research: async ({ hits }) => {
          researchCalls += 1;
          expect(hits).toHaveLength(1);
          expect(hits[0].domain).toBe('same.test');
          return {
            companies: [researched('same.test')],
            researched: 1,
            successful: 1,
            pagesScraped: 1,
            keeleadVerifyCalls: 0,
            errors: [],
          };
        },
      },
    );
    expect(researchCalls).toBe(1);
    expect(result.discovery.stats.uniqueDomains).toBe(1);
    expect(result.discovery.stats.searchResults).toBe(4);
    expect(result.discovery.stats.researched).toBe(1);
  });
});

describe('research error isolation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('continues other companies when one Firecrawl scrape fails', async () => {
    vi.spyOn(firecrawlMod.firecrawlProvider, 'mapWebsite').mockResolvedValue([]);
    vi.spyOn(firecrawlMod.firecrawlProvider, 'scrapeWebsite').mockImplementation(async (url: string) => {
      if (url.includes('bad.example')) throw new Error('firecrawl 500');
      return { url, title: 'Home', markdown: 'sales@good.example', metadata: {} };
    });
    vi.spyOn(keeleadMod.keeleadProvider, 'verifyEmail').mockResolvedValue({
      email: 'sales@good.example',
      score: 70,
      status: 'valid',
    });

    const result = await leadDiscoveryService.researchCandidates({
      hits: [hit('bad.example'), hit('good.example')],
      maxCompanies: 2,
    });
    expect(result.companies).toHaveLength(2);
    expect(result.companies.find((c) => c.domain === 'good.example')?.contacts.emails[0]?.email).toBe(
      'sales@good.example',
    );
    expect(result.errors.some((e) => e.provider === 'firecrawl' && e.domain === 'bad.example')).toBe(true);
  });

  it('keeps the email when KeeLead times out', async () => {
    vi.spyOn(firecrawlMod.firecrawlProvider, 'mapWebsite').mockResolvedValue([]);
    vi.spyOn(firecrawlMod.firecrawlProvider, 'scrapeWebsite').mockResolvedValue({
      url: 'https://mail.example/',
      title: 'Home',
      markdown: 'Contact sales@mail.example',
      metadata: {},
    });
    vi.spyOn(keeleadMod.keeleadProvider, 'verifyEmail').mockRejectedValue(
      new Error('keelead timed out after 15000ms'),
    );

    const result = await leadDiscoveryService.researchCandidates({
      hits: [hit('mail.example')],
      maxCompanies: 1,
    });
    expect(result.companies[0].contacts.emails[0]?.email).toBe('sales@mail.example');
    expect(result.companies[0].contacts.emails[0]?.verification).toBeNull();
    expect(result.errors.some((e) => e.provider === 'keelead')).toBe(true);
  });
});

describe('acquisition agent persistence + worker (postgres)', () => {
  const suffix = Date.now();
  let orgA = '';
  let orgB = '';

  beforeAll(async () => {
    await connectDatabase();
    const a = await prisma.organization.create({
      data: { name: `Lead Agent A ${suffix}`, slug: `lead-agent-a-${suffix}` },
    });
    const b = await prisma.organization.create({
      data: { name: `Lead Agent B ${suffix}`, slug: `lead-agent-b-${suffix}` },
    });
    orgA = a.id;
    orgB = b.id;
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

  it('writes execution summary metadata, provenance, and PENDING→COMPLETED', async () => {
    const prevResearch = env.leadAgentMaxResearchCompanies;
    env.leadAgentMaxResearchCompanies = 3;
    try {
      const created = await leadDiscoveryRunService.createLeadDiscoveryTask({
        organizationId: orgA,
        query: 'cardiovascular medical device distributors Saudi Arabia',
        maxCandidates: 3,
      });
      expect(created.status).toBe('PENDING');

      const result = await runAcquisitionAgent(
        {
          taskId: created.id,
          organizationId: orgA,
          prompt: created.prompt,
          targetCount: created.targetCount,
        },
        {
          budget: { ...defaultBudget, maxTotalQueries: 3, maxQueriesPerRound: 3 },
          plan: async () => ({
            plan: planOf(['q-alpha', 'q-beta', 'q-alpha']),
            source: 'llm',
          }),
          evaluate: async () => ({
            decision: {
              enoughCandidates: true,
              shouldContinueSearching: false,
              reason: 'enough',
              supplementalQueries: [],
            },
            source: 'llm',
          }),
          discover: async ({ query }) => ({
            query,
            hits: [hit('agent-co.test', 'Agent Co', 'distributor')],
            errors: [],
          }),
          research: async ({ hits }) => ({
            companies: hits.map((h) =>
              researched(h.domain, {
                search: {
                  title: 'Agent Co',
                  description: 'distributor',
                  engine: 'brave',
                  query: h.searchQuery,
                  queries: h.searchQueries,
                },
              }),
            ),
            researched: hits.length,
            successful: hits.length,
            pagesScraped: 1,
            keeleadVerifyCalls: 0,
            errors: [],
          }),
        },
      );

      const persisted = await leadPersistenceService.persistDiscoveryResult({
        organizationId: orgA,
        searchTaskId: created.id,
        discovery: result.discovery,
      });
      const completed = await leadPersistenceService.completeSearchTask({
        taskId: created.id,
        discovery: result.discovery,
        persistStats: persisted.stats,
        agentSummary: result.agentSummary,
      });

      expect(completed.status).toBe('COMPLETED');
      expect(completed.searchResultsCount).toBe(result.discovery.stats.searchResults);
      expect(completed.uniqueDomainsCount).toBe(1);
      const meta = completed.metadata as Record<string, unknown>;
      const agent = meta.acquisitionAgent as Record<string, unknown>;
      expect(agent.version).toBe(ACQUISITION_AGENT_VERSION);
      expect(agent.stopReason).toBeTruthy();
      expect(agent.requestedTarget).toBe(3);
      expect(JSON.stringify(agent)).not.toMatch(/sk-|Bearer |chain-of-thought/i);

      const sources = await prisma.leadSourceRecord.findMany({ where: { searchTaskId: created.id } });
      const searchRaw = sources.find((s) => s.provider === 'SEARXNG')?.rawData as Record<string, unknown>;
      expect(searchRaw.searchQuery || (searchRaw.searchQueries as string[])?.[0]).toBeTruthy();

      const otherOrg = await prisma.leadCompany.count({
        where: { organizationId: orgB, normalizedDomain: 'agent-co.test' },
      });
      expect(otherOrg).toBe(0);
    } finally {
      env.leadAgentMaxResearchCompanies = prevResearch;
    }
  });

  it('rejects organization mismatch before the agent runs', async () => {
    const task = await leadDiscoveryRunService.createLeadDiscoveryTask({
      organizationId: orgA,
      query: 'org isolation agent',
      maxCandidates: 1,
    });
    await expect(
      leadDiscoveryRunService.executeLeadDiscoveryTask({
        taskId: task.id,
        organizationId: orgB,
        query: 'org isolation agent',
        maxCandidates: 1,
      }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_MISMATCH' });
    const row = await prisma.leadSearchTask.findUnique({ where: { id: task.id } });
    expect(row?.status).toBe('PENDING');
  });
});
