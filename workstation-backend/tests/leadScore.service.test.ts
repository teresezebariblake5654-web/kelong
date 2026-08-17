import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { AppError } from '../src/utils/errors';
import {
  computeContactabilityScore,
  computeOverallScore,
  gradeFromOverallScore,
  leadScoreService,
  parseLlmSemanticScore,
  scoreCompanyForTask,
  scoreSearchTaskCompanies,
  type LeadScoreLlmCall,
} from '../src/services/leads/lead-score.service';
import { SCORE_WEIGHTS } from '../src/services/leads/lead-score.types';

function validSemantic(overrides?: Record<string, unknown>) {
  return {
    industryScore: 80,
    locationScore: 70,
    businessTypeScore: 60,
    productFitScore: 90,
    companyFitScore: 50,
    reasoning: {
      industry: 'medical',
      location: 'partial',
      businessType: 'maybe distributor',
      productFit: 'devices',
      companyFit: 'small',
    },
    evidence: [{ claim: 'contact page', sourceUrl: 'https://example.com/contact' }],
    insufficientEvidence: false,
    ...overrides,
  };
}

describe('ICP score pure helpers', () => {
  it('computes overallScore with fixed weights', () => {
    const overall = computeOverallScore({
      industryScore: 100,
      locationScore: 100,
      businessTypeScore: 100,
      productFitScore: 100,
      companyFitScore: 100,
      contactabilityScore: 100,
    });
    expect(overall).toBe(100);

    const mixed = computeOverallScore({
      industryScore: 100,
      locationScore: 0,
      businessTypeScore: 0,
      productFitScore: 0,
      companyFitScore: 0,
      contactabilityScore: 0,
    });
    expect(mixed).toBe(Math.round(100 * SCORE_WEIGHTS.industry));
  });

  it('maps grade boundaries', () => {
    expect(gradeFromOverallScore(90)).toBe('A');
    expect(gradeFromOverallScore(89)).toBe('B');
    expect(gradeFromOverallScore(75)).toBe('B');
    expect(gradeFromOverallScore(74)).toBe('C');
    expect(gradeFromOverallScore(60)).toBe('C');
    expect(gradeFromOverallScore(59)).toBe('D');
    expect(gradeFromOverallScore(0)).toBe('D');
  });

  it('computes contactability deterministically', () => {
    expect(
      computeContactabilityScore({
        hasVerifiedEmail: true,
        hasUnverifiedEmail: false,
        hasPhone: true,
        hasSocial: true,
        hasWebsite: true,
      }),
    ).toBe(100);
    expect(
      computeContactabilityScore({
        hasVerifiedEmail: false,
        hasUnverifiedEmail: true,
        hasPhone: false,
        hasSocial: false,
        hasWebsite: true,
      }),
    ).toBe(80);
    expect(
      computeContactabilityScore({
        hasVerifiedEmail: false,
        hasUnverifiedEmail: false,
        hasPhone: true,
        hasSocial: false,
        hasWebsite: true,
      }),
    ).toBe(60);
    expect(
      computeContactabilityScore({
        hasVerifiedEmail: false,
        hasUnverifiedEmail: false,
        hasPhone: false,
        hasSocial: true,
        hasWebsite: true,
      }),
    ).toBe(40);
    expect(
      computeContactabilityScore({
        hasVerifiedEmail: false,
        hasUnverifiedEmail: false,
        hasPhone: false,
        hasSocial: false,
        hasWebsite: true,
      }),
    ).toBe(20);
    expect(
      computeContactabilityScore({
        hasVerifiedEmail: false,
        hasUnverifiedEmail: false,
        hasPhone: false,
        hasSocial: false,
        hasWebsite: false,
      }),
    ).toBe(0);
  });

  it('rejects LLM scores outside 0-100 and forbidden keys via strict schema', () => {
    expect(() => parseLlmSemanticScore(validSemantic({ industryScore: 101 }))).toThrow(AppError);
    expect(() => parseLlmSemanticScore(validSemantic({ locationScore: -1 }))).toThrow(AppError);
    expect(() =>
      parseLlmSemanticScore(validSemantic({ overallScore: 99 })),
    ).toThrow(AppError);
    expect(() => parseLlmSemanticScore({ not: 'json-shape' })).toThrow(AppError);
  });
});

describe('ICP score persistence (postgres + injected LLM)', () => {
  const suffix = Date.now();
  let orgA = '';
  let orgB = '';
  let taskId = '';
  let companyId = '';
  let otherTaskCompanyId = '';

  const mockLlm: LeadScoreLlmCall = async ({ structuredData }) => {
    const company = (structuredData.company || {}) as Record<string, unknown>;
    const domain = String(company.domain || '');
    const directory =
      structuredData.directoryHint === true || /ensun|directory|guide/i.test(domain);

    const semantic = directory
      ? validSemantic({
          industryScore: 55,
          locationScore: 40,
          businessTypeScore: 15,
          productFitScore: 35,
          companyFitScore: 20,
          reasoning: {
            industry: 'lists medical keywords',
            location: 'global listing',
            businessType: 'directory/listing platform, not a distributor',
            productFit: 'aggregates others products',
            companyFit: 'not a buyer/dealer',
          },
          evidence: [{ claim: 'directory platform', sourceUrl: `https://${domain}/` }],
        })
      : validSemantic({
          industryScore: 85,
          locationScore: 80,
          businessTypeScore: 78,
          productFitScore: 82,
          companyFitScore: 70,
        });

    // Ensure directory evidence path is exercised in prompt payload.
    expect(structuredData).toHaveProperty('searchEvidence');
    expect(structuredData).toHaveProperty('websiteEvidence');
    expect(structuredData).toHaveProperty('directoryHint');

    return {
      output: semantic,
      provider: 'mock-icp',
      model: 'mock-icp-model',
      inputTokens: 11,
      outputTokens: 22,
    };
  };

  beforeAll(async () => {
    await connectDatabase();
    const a = await prisma.organization.create({
      data: { name: `ICP Org A ${suffix}`, slug: `icp-a-${suffix}` },
    });
    const b = await prisma.organization.create({
      data: { name: `ICP Org B ${suffix}`, slug: `icp-b-${suffix}` },
    });
    orgA = a.id;
    orgB = b.id;

    const task = await prisma.leadSearchTask.create({
      data: {
        organizationId: orgA,
        prompt: 'medical device distributors Saudi Arabia',
        status: 'COMPLETED',
        targetCount: 5,
      },
    });
    taskId = task.id;

    const company = await prisma.leadCompany.create({
      data: {
        organizationId: orgA,
        domain: 'mediserv.com.sa',
        normalizedDomain: 'mediserv.com.sa',
        website: 'https://mediserv.com.sa/',
        metadata: { candidateKind: 'company_likely', leadStage: 'candidate' },
      },
    });
    companyId = company.id;

    await prisma.leadContact.create({
      data: {
        organizationId: orgA,
        companyId,
        email: 'info@mediserv.com.sa',
        emailNormalized: 'info@mediserv.com.sa',
        emailVerificationStatus: null,
      },
    });

    await prisma.leadSourceRecord.createMany({
      data: [
        {
          organizationId: orgA,
          searchTaskId: taskId,
          companyId,
          provider: 'SEARXNG',
          sourceType: 'WEB_SEARCH',
          sourceUrl: 'https://mediserv.com.sa/',
          rawData: {
            title: 'Mediserv',
            description: 'medical distributor',
            engine: 'brave',
            candidateKind: 'company_likely',
          },
        },
        {
          organizationId: orgA,
          searchTaskId: taskId,
          companyId,
          provider: 'FIRECRAWL',
          sourceType: 'WEBSITE_RESEARCH',
          sourceUrl: 'https://mediserv.com.sa/contact',
          rawData: { title: 'Contact', emailCount: 1, phoneCount: 0, socialCount: 0 },
        },
      ],
    });

    const dir = await prisma.leadCompany.create({
      data: {
        organizationId: orgA,
        domain: 'ensun.io',
        normalizedDomain: 'ensun.io',
        website: 'https://ensun.io/',
        metadata: {
          candidateKind: 'directory_likely',
          searchTitle: 'Top medical device companies directory',
        },
      },
    });
    await prisma.leadSourceRecord.create({
      data: {
        organizationId: orgA,
        searchTaskId: taskId,
        companyId: dir.id,
        provider: 'SEARXNG',
        sourceType: 'WEB_SEARCH',
        sourceUrl: 'https://ensun.io/',
        rawData: {
          title: 'Top companies directory',
          description: 'B2B directory',
          engine: 'brave',
          candidateKind: 'directory_likely',
        },
      },
    });

    // Company linked only to another task — must not be scored for taskId.
    const otherTask = await prisma.leadSearchTask.create({
      data: {
        organizationId: orgA,
        prompt: 'unrelated task',
        status: 'COMPLETED',
        targetCount: 1,
      },
    });
    const other = await prisma.leadCompany.create({
      data: {
        organizationId: orgA,
        domain: 'other-task-only.test',
        normalizedDomain: 'other-task-only.test',
        website: 'https://other-task-only.test/',
      },
    });
    otherTaskCompanyId = other.id;
    await prisma.leadSourceRecord.create({
      data: {
        organizationId: orgA,
        searchTaskId: otherTask.id,
        companyId: other.id,
        provider: 'SEARXNG',
        sourceType: 'WEB_SEARCH',
        sourceUrl: 'https://other-task-only.test/',
        rawData: { title: 'other' },
      },
    });
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

  it('rejects organization mismatch', async () => {
    await expect(
      scoreCompanyForTask({
        organizationId: orgB,
        searchTaskId: taskId,
        companyId,
        llmCall: mockLlm,
      }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_MISMATCH' });
  });

  it('malformed LLM JSON does not write a score', async () => {
    const before = await prisma.leadScore.count({
      where: { searchTaskId: taskId, companyId },
    });
    await expect(
      scoreCompanyForTask({
        organizationId: orgA,
        searchTaskId: taskId,
        companyId,
        llmCall: async () => ({
          output: { broken: true },
          provider: 'x',
          model: 'y',
          inputTokens: 1,
          outputTokens: 1,
        }),
      }),
    ).rejects.toBeInstanceOf(AppError);
    const after = await prisma.leadScore.count({
      where: { searchTaskId: taskId, companyId },
    });
    expect(after).toBe(before);
  });

  it('upserts score for same task/company and scores directory lower on businessType', async () => {
    const first = await scoreCompanyForTask({
      organizationId: orgA,
      searchTaskId: taskId,
      companyId,
      llmCall: mockLlm,
    });
    expect(first.contactabilityScore).toBe(80);
    expect(first.grade).toBe(gradeFromOverallScore(first.overallScore));

    const second = await scoreCompanyForTask({
      organizationId: orgA,
      searchTaskId: taskId,
      companyId,
      llmCall: mockLlm,
    });
    expect(second.scoreId).toBe(first.scoreId);
    const count = await prisma.leadScore.count({
      where: { searchTaskId: taskId, companyId },
    });
    expect(count).toBe(1);

    const taskResult = await scoreSearchTaskCompanies({
      organizationId: orgA,
      searchTaskId: taskId,
      maxCompanies: 5,
      llmCall: mockLlm,
    });

    expect(taskResult.companies.map((c) => c.domain)).not.toContain('other-task-only.test');
    expect(taskResult.companies.some((c) => c.domain === 'ensun.io')).toBe(true);

    const ensun = await prisma.leadScore.findFirst({
      where: { searchTaskId: taskId, company: { normalizedDomain: 'ensun.io' } },
    });
    const medi = await prisma.leadScore.findFirst({
      where: { searchTaskId: taskId, companyId },
    });
    expect(ensun).toBeTruthy();
    expect(medi).toBeTruthy();
    expect(ensun!.businessTypeScore).toBeLessThan(medi!.businessTypeScore);
    expect(ensun!.overallScore).toBeLessThan(medi!.overallScore);
  });

  it('one company LLM failure does not stop the rest', async () => {
    let calls = 0;
    const flaky: LeadScoreLlmCall = async (args) => {
      calls += 1;
      const domain = String((args.structuredData.company as { domain?: string })?.domain || '');
      if (domain === 'ensun.io') {
        throw new AppError(502, 'forced fail', 'ICP_LLM_INVALID_JSON');
      }
      return mockLlm(args);
    };

    const result = await scoreSearchTaskCompanies({
      organizationId: orgA,
      searchTaskId: taskId,
      maxCompanies: 5,
      llmCall: flaky,
    });
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.scored).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.domain === 'ensun.io')).toBe(true);
  });
});
