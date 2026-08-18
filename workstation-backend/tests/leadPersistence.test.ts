import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import type { DiscoveryPreviewResult } from '../src/services/leads/lead-discovery.service';
import * as agentMod from '../src/services/leads/agent/acquisition-agent-orchestrator.service';
import { ACQUISITION_AGENT_VERSION } from '../src/services/leads/agent/acquisition-agent.types';
import type { AcquisitionAgentRunResult } from '../src/services/leads/agent/acquisition-agent-orchestrator.service';
import {
  leadPersistenceService,
  mergeStringField,
  normalizeLeadDomain,
  normalizeLeadEmail,
  persistDiscoveryResult,
} from '../src/services/leads/lead-persistence.service';
import { leadDiscoveryRunService } from '../src/services/leads/lead-discovery-run.service';

function wrapAgent(discovery: DiscoveryPreviewResult): AcquisitionAgentRunResult {
  return {
    discovery,
    agentSummary: {
      version: ACQUISITION_AGENT_VERSION,
      requestedTarget: 1,
      effectiveResearchLimit: 1,
      plan: { queryCount: 3, source: 'fallback' },
      executedQueries: [],
      searchRounds: 1,
      uniqueCandidates: discovery.stats.uniqueDomains,
      stopReason: 'TARGET_REACHED',
    },
  };
}

function sampleDiscovery(overrides?: Partial<DiscoveryPreviewResult>): DiscoveryPreviewResult {
  return {
    query: 'medical device distributors Saudi Arabia',
    stats: {
      searchResults: 20,
      uniqueDomains: 19,
      researched: 1,
      successful: 1,
      pagesScraped: 3,
      keeleadVerifyCalls: 1,
    },
    companies: [
      {
        domain: 'www.Example.com',
        website: 'https://www.example.com/',
        search: {
          title: 'Example Medical',
          description: 'Distributor',
          engine: 'brave',
        },
        candidateKind: 'company_likely',
        researchedPages: [
          'https://example.com/',
          'https://example.com/contact',
          'https://example.com/about',
        ],
        websiteResearch: { title: 'Example', markdownPreview: 'sales@Example.COM' },
        contacts: {
          emails: [
            {
              email: 'SALES@Example.COM',
              sourceUrl: 'https://example.com/contact',
              verification: { status: 'valid', score: 88 },
            },
          ],
          phones: [
            { phone: '20231227160311', sourceUrl: 'https://example.com/' },
            { phone: '+966 11 123 4567', sourceUrl: 'https://example.com/contact' },
          ],
          linkedin: [{ url: 'https://linkedin.com/company/example' }],
          facebook: [],
          instagram: [],
        },
        sources: ['searxng', 'firecrawl', 'keelead'],
      },
    ],
    errors: [],
    durationMs: 10,
    ...overrides,
  };
}

describe('lead persistence helpers', () => {
  it('normalizes domains from url/host variants', () => {
    expect(normalizeLeadDomain('https://www.example.com/contact')).toBe('example.com');
    expect(normalizeLeadDomain('http://example.com')).toBe('example.com');
    expect(normalizeLeadDomain('EXAMPLE.COM')).toBe('example.com');
  });

  it('normalizes emails to lowercase', () => {
    expect(normalizeLeadEmail('SALES@ABC.COM')).toBe('sales@abc.com');
  });

  it('mergeStringField never overwrites with null/empty', () => {
    expect(mergeStringField('ABC Medical', null)).toBe('ABC Medical');
    expect(mergeStringField('ABC Medical', '')).toBe('ABC Medical');
    expect(mergeStringField('ABC Medical', 'New Name')).toBe('New Name');
    expect(mergeStringField(null, null)).toBeNull();
  });
});

describe('lead persistence (postgres)', () => {
  const suffix = Date.now();
  let orgA = '';
  let orgB = '';

  beforeAll(async () => {
    await connectDatabase();
    const a = await prisma.organization.create({
      data: { name: `Lead Persist A ${suffix}`, slug: `lead-persist-a-${suffix}` },
    });
    const b = await prisma.organization.create({
      data: { name: `Lead Persist B ${suffix}`, slug: `lead-persist-b-${suffix}` },
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

  it('creates company + email contact + source records; phones do not create contacts', async () => {
    const task = await leadPersistenceService.createRunningSearchTask({
      organizationId: orgA,
      prompt: 'q1',
      targetCount: 3,
    });
    const result = await persistDiscoveryResult({
      organizationId: orgA,
      searchTaskId: task.id,
      discovery: sampleDiscovery(),
    });
    await leadPersistenceService.completeSearchTask({
      taskId: task.id,
      discovery: sampleDiscovery(),
      persistStats: result.stats,
    });

    expect(result.stats.createdCompanies).toBe(1);
    expect(result.stats.createdContacts).toBe(1);
    expect(result.companies[0].domain).toBe('example.com');
    expect(result.companies[0].contacts[0].emailNormalized).toBe('sales@example.com');
    expect(result.companies[0].contacts[0].emailVerificationStatus).toBe('valid');

    const contacts = await prisma.leadContact.count({
      where: { organizationId: orgA, companyId: result.companies[0].id },
    });
    expect(contacts).toBe(1);

    const company = await prisma.leadCompany.findUniqueOrThrow({
      where: { id: result.companies[0].id },
    });
    const meta = company.metadata as Record<string, unknown>;
    expect(meta.leadStage).toBe('candidate');
    expect(meta.qualification).toBe('undecided_candidate');
    expect(Array.isArray(meta.discoveredPhones)).toBe(true);
    expect((meta.discoveredPhones as string[]).length).toBeGreaterThanOrEqual(1);
    expect(company.linkedinUrl).toContain('linkedin.com');
    expect(company.name).toBeNull();

    const sources = await prisma.leadSourceRecord.findMany({ where: { searchTaskId: task.id } });
    const providers = sources.map((s) => `${s.provider}:${s.sourceType}`);
    expect(providers).toContain('SEARXNG:WEB_SEARCH');
    expect(providers.filter((p) => p === 'FIRECRAWL:WEBSITE_RESEARCH')).toHaveLength(3);
    expect(providers).toContain('KEELEAD:EMAIL_VERIFICATION');

    const completed = await prisma.leadSearchTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(completed.status).toBe('COMPLETED');
  });

  it('same org + normalizedDomain upserts; same email merges; no duplicate sources in same task', async () => {
    const task = await leadPersistenceService.createRunningSearchTask({
      organizationId: orgA,
      prompt: 'q2',
      targetCount: 3,
    });

    const first = await persistDiscoveryResult({
      organizationId: orgA,
      searchTaskId: task.id,
      discovery: sampleDiscovery({
        companies: [
          {
            ...sampleDiscovery().companies[0],
            domain: 'example.com',
            contacts: {
              ...sampleDiscovery().companies[0].contacts,
              emails: [
                {
                  email: 'sales@example.com',
                  verification: { status: 'unknown', score: 40 },
                },
              ],
            },
          },
        ],
      }),
    });

    const beforeCompanies = await prisma.leadCompany.count({ where: { organizationId: orgA } });
    const beforeContacts = await prisma.leadContact.count({ where: { organizationId: orgA } });
    const beforeSources = await prisma.leadSourceRecord.count({ where: { searchTaskId: task.id } });

    const second = await persistDiscoveryResult({
      organizationId: orgA,
      searchTaskId: task.id,
      discovery: sampleDiscovery({
        companies: [
          {
            ...sampleDiscovery().companies[0],
            domain: 'https://www.example.com/about',
            contacts: {
              ...sampleDiscovery().companies[0].contacts,
              emails: [
                {
                  email: 'SALES@EXAMPLE.COM',
                  verification: { status: 'valid', score: 90 },
                },
              ],
            },
          },
        ],
      }),
    });

    expect(second.stats.createdCompanies).toBe(0);
    expect(second.stats.updatedCompanies).toBe(1);
    expect(second.stats.createdContacts).toBe(0);
    expect(second.stats.updatedContacts).toBe(1);

    const afterCompanies = await prisma.leadCompany.count({ where: { organizationId: orgA } });
    const afterContacts = await prisma.leadContact.count({ where: { organizationId: orgA } });
    const afterSources = await prisma.leadSourceRecord.count({ where: { searchTaskId: task.id } });

    expect(afterCompanies).toBe(beforeCompanies);
    expect(afterContacts).toBe(beforeContacts);
    expect(afterSources).toBe(beforeSources);
    expect(first.companies[0].id).toBe(second.companies[0].id);

    const contact = await prisma.leadContact.findFirstOrThrow({
      where: {
        organizationId: orgA,
        companyId: second.companies[0].id,
        emailNormalized: 'sales@example.com',
      },
    });
    expect(contact.emailVerificationScore).toBe(90);
  });

  it('null incoming fields do not wipe existing company data', async () => {
    const seeded = await prisma.leadCompany.create({
      data: {
        organizationId: orgA,
        name: 'ABC Medical',
        domain: 'abc-medical.test',
        normalizedDomain: 'abc-medical.test',
        website: 'https://abc-medical.test/',
        country: 'SA',
        linkedinUrl: 'https://linkedin.com/company/abc',
      },
    });
    const task = await leadPersistenceService.createRunningSearchTask({
      organizationId: orgA,
      prompt: 'q3',
      targetCount: 1,
    });

    await persistDiscoveryResult({
      organizationId: orgA,
      searchTaskId: task.id,
      discovery: sampleDiscovery({
        companies: [
          {
            domain: 'abc-medical.test',
            website: '',
            search: { title: '', description: '', engine: 'x' },
            candidateKind: 'company_likely',
            researchedPages: ['https://abc-medical.test/'],
            websiteResearch: { title: 't', markdownPreview: '' },
            contacts: {
              emails: [],
              phones: [],
              linkedin: [],
              facebook: [],
              instagram: [],
            },
            sources: ['searxng', 'firecrawl'],
          },
        ],
      }),
    });

    const updated = await prisma.leadCompany.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(updated.name).toBe('ABC Medical');
    expect(updated.website).toBe('https://abc-medical.test/');
    expect(updated.country).toBe('SA');
    expect(updated.linkedinUrl).toContain('linkedin.com');
  });

  it('different organizations can both own the same domain', async () => {
    const taskA = await leadPersistenceService.createRunningSearchTask({
      organizationId: orgA,
      prompt: 'iso-a',
      targetCount: 1,
    });
    const taskB = await leadPersistenceService.createRunningSearchTask({
      organizationId: orgB,
      prompt: 'iso-b',
      targetCount: 1,
    });
    const discovery = sampleDiscovery({
      companies: [
        {
          ...sampleDiscovery().companies[0],
          domain: 'shared-domain.test',
          website: 'https://shared-domain.test/',
          researchedPages: ['https://shared-domain.test/'],
          contacts: {
            emails: [{ email: 'info@shared-domain.test', verification: null }],
            phones: [],
            linkedin: [],
            facebook: [],
            instagram: [],
          },
        },
      ],
    });

    const a = await persistDiscoveryResult({
      organizationId: orgA,
      searchTaskId: taskA.id,
      discovery,
    });
    const b = await persistDiscoveryResult({
      organizationId: orgB,
      searchTaskId: taskB.id,
      discovery,
    });

    expect(a.companies[0].id).not.toBe(b.companies[0].id);

    const aRow = await prisma.leadCompany.findUnique({ where: { id: a.companies[0].id } });
    const bRow = await prisma.leadCompany.findUnique({ where: { id: b.companies[0].id } });
    expect(aRow?.organizationId).toBe(orgA);
    expect(bRow?.organizationId).toBe(orgB);

    const cross = await prisma.leadCompany.findFirst({
      where: { id: a.companies[0].id, organizationId: orgB },
    });
    expect(cross).toBeNull();
  });

  it('saves email even when verification is null (timeout case)', async () => {
    const task = await leadPersistenceService.createRunningSearchTask({
      organizationId: orgA,
      prompt: 'verify-null',
      targetCount: 1,
    });
    const result = await persistDiscoveryResult({
      organizationId: orgA,
      searchTaskId: task.id,
      discovery: sampleDiscovery({
        companies: [
          {
            ...sampleDiscovery().companies[0],
            domain: 'timeout-mail.test',
            website: 'https://timeout-mail.test/',
            researchedPages: ['https://timeout-mail.test/contact'],
            contacts: {
              emails: [
                {
                  email: 'hello@timeout-mail.test',
                  sourceUrl: 'https://timeout-mail.test/contact',
                  verification: null,
                },
              ],
              phones: [],
              linkedin: [],
              facebook: [],
              instagram: [],
            },
          },
        ],
      }),
    });

    expect(result.stats.createdContacts).toBe(1);
    const contact = await prisma.leadContact.findFirstOrThrow({
      where: {
        organizationId: orgA,
        emailNormalized: 'hello@timeout-mail.test',
      },
    });
    expect(contact.email).toBe('hello@timeout-mail.test');
    expect(contact.emailVerificationStatus).toBeNull();
  });

  it('one company persist failure does not roll back siblings', async () => {
    const task = await leadPersistenceService.createRunningSearchTask({
      organizationId: orgA,
      prompt: 'partial-fail',
      targetCount: 2,
    });

    const result = await persistDiscoveryResult({
      organizationId: orgA,
      searchTaskId: task.id,
      discovery: sampleDiscovery({
        companies: [
          {
            ...sampleDiscovery().companies[0],
            // Empty domain is skipped with an error; must not block the next company.
            domain: '',
            researchedPages: [],
            contacts: { emails: [], phones: [], linkedin: [], facebook: [], instagram: [] },
          },
          {
            ...sampleDiscovery().companies[0],
            domain: 'ok-second.test',
            researchedPages: ['https://ok-second.test/'],
            contacts: {
              emails: [{ email: 'ok@ok-second.test', verification: null }],
              phones: [],
              linkedin: [],
              facebook: [],
              instagram: [],
            },
          },
        ],
      }),
    });

    expect(result.errors.some((e) => e.code === 'PERSIST_SKIP_NO_DOMAIN')).toBe(true);
    expect(result.stats.savedCompanies).toBe(1);
    const ok = await prisma.leadCompany.findFirst({
      where: { organizationId: orgA, normalizedDomain: 'ok-second.test' },
    });
    expect(ok).toBeTruthy();
  });

  it('executeLeadDiscoveryTask keeps RUNNING on first system error (retries still possible)', async () => {
    const spy = vi
      .spyOn(agentMod.acquisitionAgentOrchestrator, 'run')
      .mockRejectedValueOnce(new Error('searxng down'));

    try {
      await expect(
        leadDiscoveryRunService.runLeadDiscovery({
          organizationId: orgA,
          query: 'system failure query',
          maxCandidates: 1,
        }),
      ).rejects.toThrow(/searxng down/);

      const running = await prisma.leadSearchTask.findFirst({
        where: { organizationId: orgA, prompt: 'system failure query' },
        orderBy: { createdAt: 'desc' },
      });
      expect(running?.status).toBe('RUNNING');
      expect(running?.completedAt).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('runLeadDiscovery COMPLETED path with mocked discovery does not invent emails', async () => {
    const uniqueDomain = `run-path-${suffix}.test`;
    const spy = vi.spyOn(agentMod.acquisitionAgentOrchestrator, 'run').mockResolvedValue(
      wrapAgent(
        sampleDiscovery({
          companies: [
            {
              ...sampleDiscovery().companies[0],
              domain: uniqueDomain,
              website: `https://${uniqueDomain}/`,
              researchedPages: [`https://${uniqueDomain}/`],
              contacts: {
                emails: [
                  {
                    email: `a@${uniqueDomain}`,
                    verification: { status: 'valid', score: 1 },
                  },
                ],
                phones: [{ phone: '111' }],
                linkedin: [],
                facebook: [],
                instagram: [],
              },
            },
          ],
        }),
      ),
    );

    try {
      const result = await leadDiscoveryRunService.runLeadDiscovery({
        organizationId: orgA,
        query: 'run path query',
        maxCandidates: 1,
      });

      expect(spy).toHaveBeenCalled();
      expect(result.task.status).toBe('COMPLETED');
      expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
      expect(result.companies.length, JSON.stringify(result.stats)).toBe(1);
      expect(result.stats.savedCompanies).toBe(1);
      expect(result.stats.createdCompanies).toBe(1);
      expect(result.stats.createdContacts).toBe(1);
      expect(result.companies[0].contacts).toHaveLength(1);
      expect(result.companies[0].contacts[0].emailNormalized).toBe(`a@${uniqueDomain}`);

      const contactCount = await prisma.leadContact.count({
        where: { organizationId: orgA, companyId: result.companies[0].id },
      });
      expect(contactCount).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
