import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { AppError } from '../src/utils/errors';
import {
  getCompanyDetail,
  getSearchTask,
  getSearchTaskResults,
  listSearchTasks,
  sortCompanyResults,
} from '../src/services/leads/lead-pool.service';
import type { LeadPoolCompanyResultDto } from '../src/services/leads/lead-pool.types';

describe('lead-pool sort helpers', () => {
  it('sorts by overallScore DESC and puts unscored last', () => {
    const rows: LeadPoolCompanyResultDto[] = [
      {
        id: 'u1',
        name: null,
        domain: 'unscored.com',
        website: null,
        country: null,
        city: null,
        industry: null,
        description: null,
        social: { linkedin: null, facebook: null, instagram: null },
        score: null,
        contacts: [],
        sourceSummary: { providers: [], searchSources: 0, researchPages: 0, emailVerifications: 0 },
      },
      {
        id: 'a',
        name: null,
        domain: 'a.com',
        website: null,
        country: null,
        city: null,
        industry: null,
        description: null,
        social: { linkedin: null, facebook: null, instagram: null },
        score: {
          overallScore: 70,
          grade: 'C',
          industryScore: 70,
          locationScore: 70,
          businessTypeScore: 70,
          productFitScore: 70,
          companyFitScore: 70,
          contactabilityScore: 70,
          reasoning: {},
          evidence: [],
        },
        contacts: [],
        sourceSummary: { providers: [], searchSources: 0, researchPages: 0, emailVerifications: 0 },
      },
      {
        id: 'b',
        name: null,
        domain: 'b.com',
        website: null,
        country: null,
        city: null,
        industry: null,
        description: null,
        social: { linkedin: null, facebook: null, instagram: null },
        score: {
          overallScore: 95,
          grade: 'A',
          industryScore: 95,
          locationScore: 95,
          businessTypeScore: 95,
          productFitScore: 95,
          companyFitScore: 95,
          contactabilityScore: 95,
          reasoning: {},
          evidence: [],
        },
        contacts: [],
        sourceSummary: { providers: [], searchSources: 0, researchPages: 0, emailVerifications: 0 },
      },
    ];
    const updated = new Map<string, Date>([
      ['u1', new Date('2026-01-01')],
      ['a', new Date('2026-01-02')],
      ['b', new Date('2026-01-03')],
    ]);
    const sorted = sortCompanyResults(rows, updated);
    expect(sorted.map((r) => r.domain)).toEqual(['b.com', 'a.com', 'unscored.com']);
  });
});

describe('lead-pool read APIs (postgres)', () => {
  const suffix = Date.now();
  let orgA = '';
  let orgB = '';
  let taskA = '';
  let taskB = '';
  let companyHigh = '';
  let companyLow = '';
  let companyUnscored = '';
  let companyOtherTask = '';
  let companyOrgB = '';

  beforeAll(async () => {
    await connectDatabase();
    const a = await prisma.organization.create({
      data: { name: `Pool Org A ${suffix}`, slug: `pool-a-${suffix}` },
    });
    const b = await prisma.organization.create({
      data: { name: `Pool Org B ${suffix}`, slug: `pool-b-${suffix}` },
    });
    orgA = a.id;
    orgB = b.id;

    const tA = await prisma.leadSearchTask.create({
      data: {
        organizationId: orgA,
        prompt: `pool medical device distributors Saudi Arabia ${suffix}`,
        status: 'COMPLETED',
        targetCount: 3,
        searchResultsCount: 10,
        uniqueDomainsCount: 3,
        researchedCount: 3,
        successfulCount: 3,
        completedAt: new Date(),
      },
    });
    const tB = await prisma.leadSearchTask.create({
      data: {
        organizationId: orgA,
        prompt: `other task ${suffix}`,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
    taskA = tA.id;
    taskB = tB.id;

    const high = await prisma.leadCompany.create({
      data: {
        organizationId: orgA,
        domain: `mediserv-pool-${suffix}.com.sa`,
        normalizedDomain: `mediserv-pool-${suffix}.com.sa`,
        name: 'MediServ Pool',
        website: `https://mediserv-pool-${suffix}.com.sa`,
        industry: 'medical devices',
        country: 'Saudi Arabia',
        metadata: { discoveredPhones: ['+966500000001'] },
        updatedAt: new Date('2026-08-01T10:00:00Z'),
      },
    });
    const low = await prisma.leadCompany.create({
      data: {
        organizationId: orgA,
        domain: `ensun-pool-${suffix}.io`,
        normalizedDomain: `ensun-pool-${suffix}.io`,
        name: 'Ensun Directory',
        website: `https://ensun-pool-${suffix}.io`,
        industry: 'B2B directory',
        updatedAt: new Date('2026-08-01T09:00:00Z'),
      },
    });
    const unscored = await prisma.leadCompany.create({
      data: {
        organizationId: orgA,
        domain: `unscored-pool-${suffix}.com`,
        normalizedDomain: `unscored-pool-${suffix}.com`,
        name: 'Unscored Co',
        website: `https://unscored-pool-${suffix}.com`,
        updatedAt: new Date('2026-08-01T11:00:00Z'),
      },
    });
    const otherTaskCo = await prisma.leadCompany.create({
      data: {
        organizationId: orgA,
        domain: `other-task-${suffix}.com`,
        normalizedDomain: `other-task-${suffix}.com`,
        name: 'Other Task Co',
        website: `https://other-task-${suffix}.com`,
      },
    });
    const orgBCo = await prisma.leadCompany.create({
      data: {
        organizationId: orgB,
        domain: `orgb-${suffix}.com`,
        normalizedDomain: `orgb-${suffix}.com`,
        name: 'Org B Co',
        website: `https://orgb-${suffix}.com`,
      },
    });
    companyHigh = high.id;
    companyLow = low.id;
    companyUnscored = unscored.id;
    companyOtherTask = otherTaskCo.id;
    companyOrgB = orgBCo.id;

    await prisma.leadContact.create({
      data: {
        organizationId: orgA,
        companyId: companyHigh,
        fullName: 'Sales Desk',
        email: `sales@mediserv-pool-${suffix}.com.sa`,
        emailNormalized: `sales@mediserv-pool-${suffix}.com.sa`,
        emailVerificationStatus: 'valid',
        emailVerificationScore: 90,
      },
    });
    // Duplicate-safe: second contact without email (phone only on company metadata for high)

    await prisma.leadContact.create({
      data: {
        organizationId: orgA,
        companyId: companyLow,
        fullName: 'Dir Contact',
        linkedinUrl: 'https://linkedin.com/company/ensun',
      },
    });

    // Link task A companies via source records
    for (const [companyId, provider, sourceType] of [
      [companyHigh, 'SEARXNG', 'WEB_SEARCH'],
      [companyHigh, 'FIRECRAWL', 'WEBSITE_RESEARCH'],
      [companyHigh, 'FIRECRAWL', 'WEBSITE_RESEARCH'],
      [companyHigh, 'KEELEAD', 'EMAIL_VERIFICATION'],
      [companyLow, 'SEARXNG', 'WEB_SEARCH'],
      [companyUnscored, 'SEARXNG', 'WEB_SEARCH'],
    ] as const) {
      await prisma.leadSourceRecord.create({
        data: {
          organizationId: orgA,
          searchTaskId: taskA,
          companyId,
          provider,
          sourceType,
          sourceUrl: `https://example.com/${provider}/${companyId}/${Math.random()}`,
          rawData: { title: `${provider} title`, description: 'desc' },
        },
      });
    }

    await prisma.leadSourceRecord.create({
      data: {
        organizationId: orgA,
        searchTaskId: taskB,
        companyId: companyOtherTask,
        provider: 'SEARXNG',
        sourceType: 'WEB_SEARCH',
        sourceUrl: 'https://example.com/other',
      },
    });

    await prisma.leadScore.create({
      data: {
        organizationId: orgA,
        searchTaskId: taskA,
        companyId: companyHigh,
        overallScore: 96,
        grade: 'A',
        industryScore: 98,
        locationScore: 100,
        businessTypeScore: 94,
        productFitScore: 98,
        companyFitScore: 96,
        contactabilityScore: 80,
        reasoning: { industry: 'medical' },
        evidence: [{ claim: 'sa distributor' }],
        scoringVersion: 'icp-v1',
      },
    });
    await prisma.leadScore.create({
      data: {
        organizationId: orgA,
        searchTaskId: taskA,
        companyId: companyLow,
        overallScore: 8,
        grade: 'D',
        industryScore: 15,
        locationScore: 5,
        businessTypeScore: 0,
        productFitScore: 10,
        companyFitScore: 0,
        contactabilityScore: 20,
        reasoning: { businessType: 'directory' },
        evidence: [],
        scoringVersion: 'icp-v1',
      },
    });
    // Scored on another task only — still UNSCORED for taskA.
    await prisma.leadScore.create({
      data: {
        organizationId: orgA,
        searchTaskId: taskB,
        companyId: companyUnscored,
        overallScore: 91,
        grade: 'A',
        industryScore: 90,
        locationScore: 90,
        businessTypeScore: 90,
        productFitScore: 90,
        companyFitScore: 90,
        contactabilityScore: 90,
        reasoning: { note: 'scored on other task' },
        evidence: [],
        scoringVersion: 'icp-v1',
      },
    });
  });

  afterAll(async () => {
    await prisma.leadScore.deleteMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    await prisma.leadSourceRecord.deleteMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    await prisma.leadContact.deleteMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    await prisma.leadCompany.deleteMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    await prisma.leadSearchTask.deleteMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await disconnectDatabase();
  });

  it('rejects org mismatch on task results', async () => {
    await expect(
      getSearchTaskResults({
        organizationId: orgB,
        searchTaskId: taskA,
        query: { page: 1, pageSize: 20 },
      }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_MISMATCH' } satisfies Partial<AppError>);
  });

  it('returns only companies linked to the search task', async () => {
    const data = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: taskA,
      query: { page: 1, pageSize: 20 },
    });
    const domains = data.companies.map((c) => c.domain);
    expect(domains).toContain(`mediserv-pool-${suffix}.com.sa`);
    expect(domains).toContain(`ensun-pool-${suffix}.io`);
    expect(domains).toContain(`unscored-pool-${suffix}.com`);
    expect(domains).not.toContain(`other-task-${suffix}.com`);
    expect(domains).not.toContain(`orgb-${suffix}.com`);
  });

  it('sorts score DESC and unscored last', async () => {
    const data = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: taskA,
      query: { page: 1, pageSize: 20 },
    });
    expect(data.companies.map((c) => c.domain)).toEqual([
      `mediserv-pool-${suffix}.com.sa`,
      `ensun-pool-${suffix}.io`,
      `unscored-pool-${suffix}.com`,
    ]);
    expect(data.companies[0].score?.overallScore).toBe(96);
    expect(data.companies[2].score).toBeNull();
  });

  it('filters by grade=A', async () => {
    const data = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: taskA,
      query: { page: 1, pageSize: 20, grade: 'A' },
    });
    expect(data.companies).toHaveLength(1);
    expect(data.companies[0].score?.grade).toBe('A');
    // Summary still reflects full task, not filtered page
    expect(data.summary.total).toBe(3);
    expect(data.summary.grades.A).toBe(1);
    expect(data.summary.grades.D).toBe(1);
    expect(data.summary.grades.UNSCORED).toBe(1);
    expect(data.pagination.total).toBe(1);
  });

  it('filters by grade=B and grade=C without matching UNSCORED', async () => {
    const b = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: taskA,
      query: { page: 1, pageSize: 20, grade: 'B' },
    });
    expect(b.companies).toHaveLength(0);
    expect(b.pagination.total).toBe(0);
    expect(b.summary.total).toBe(3);

    const c = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: taskA,
      query: { page: 1, pageSize: 20, grade: 'C' },
    });
    expect(c.companies).toHaveLength(0);
    expect(c.pagination.total).toBe(0);
    expect(c.summary.grades.UNSCORED).toBe(1);
  });

  it('filters by grade=D', async () => {
    const data = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: taskA,
      query: { page: 1, pageSize: 20, grade: 'D' },
    });
    expect(data.companies).toHaveLength(1);
    expect(data.companies[0].score?.grade).toBe('D');
    expect(data.companies[0].id).toBe(companyLow);
    expect(data.pagination.total).toBe(1);
    expect(data.summary.total).toBe(3);
    expect(data.summary.grades.A).toBe(1);
    expect(data.summary.grades.D).toBe(1);
  });

  it('filters by grade=UNSCORED for current task only', async () => {
    const data = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: taskA,
      query: { page: 1, pageSize: 20, grade: 'UNSCORED' },
    });
    expect(data.companies).toHaveLength(1);
    expect(data.companies[0].id).toBe(companyUnscored);
    expect(data.companies[0].score).toBeNull();
    expect(data.pagination.total).toBe(1);
    expect(data.pagination.totalPages).toBe(1);
  });

  it('treats a company scored on another task as UNSCORED for the current task', async () => {
    const data = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: taskA,
      query: { page: 1, pageSize: 20, grade: 'UNSCORED' },
    });
    expect(data.companies.map((c) => c.id)).toEqual([companyUnscored]);
    expect(data.companies.every((c) => c.score == null)).toBe(true);
    expect(data.companies.map((c) => c.id)).not.toContain(companyHigh);
    expect(data.companies.map((c) => c.id)).not.toContain(companyLow);
  });

  it('paginates UNSCORED after filtering and keeps summary unfiltered', async () => {
    const page1 = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: taskA,
      query: { page: 1, pageSize: 1, grade: 'UNSCORED' },
    });
    expect(page1.companies).toHaveLength(1);
    expect(page1.companies[0].score).toBeNull();
    expect(page1.pagination).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    });
    expect(page1.summary.total).toBe(3);
    expect(page1.summary.scored).toBe(2);
    expect(page1.summary.grades.A).toBe(1);
    expect(page1.summary.grades.D).toBe(1);
    expect(page1.summary.grades.UNSCORED).toBe(1);
    expect(page1.summary.withEmail).toBe(1);

    const emptyPage = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: taskA,
      query: { page: 2, pageSize: 1, grade: 'UNSCORED' },
    });
    expect(emptyPage.companies).toHaveLength(0);
    expect(emptyPage.pagination.total).toBe(1);
    expect(emptyPage.pagination.totalPages).toBe(1);
    expect(emptyPage.summary.total).toBe(3);
    expect(emptyPage.summary.grades.UNSCORED).toBe(1);
  });

  it('filters by minScore', async () => {
    const data = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: taskA,
      query: { page: 1, pageSize: 20, minScore: 75 },
    });
    expect(data.companies).toHaveLength(1);
    expect(data.companies[0].score!.overallScore).toBeGreaterThanOrEqual(75);
  });

  it('filters hasEmail / hasPhone', async () => {
    const withEmail = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: taskA,
      query: { page: 1, pageSize: 20, hasEmail: true },
    });
    expect(withEmail.companies.every((c) => c.contacts.some((x) => !!x.email))).toBe(true);
    expect(withEmail.companies).toHaveLength(1);

    const withPhone = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: taskA,
      query: { page: 1, pageSize: 20, hasPhone: true },
    });
    expect(withPhone.companies.map((c) => c.id)).toContain(companyHigh);
  });

  it('paginates without shrinking summary', async () => {
    const page1 = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: taskA,
      query: { page: 1, pageSize: 1 },
    });
    expect(page1.companies).toHaveLength(1);
    expect(page1.pagination).toMatchObject({ page: 1, pageSize: 1, total: 3, totalPages: 3 });
    expect(page1.summary.total).toBe(3);
    expect(page1.summary.scored).toBe(2);

    const page2 = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: taskA,
      query: { page: 2, pageSize: 1 },
    });
    expect(page2.companies).toHaveLength(1);
    expect(page2.companies[0].domain).not.toBe(page1.companies[0].domain);
    expect(page2.summary.total).toBe(3);
  });

  it('does not duplicate contacts and builds sourceSummary', async () => {
    const data = await getSearchTaskResults({
      organizationId: orgA,
      searchTaskId: taskA,
      query: { page: 1, pageSize: 20 },
    });
    const high = data.companies.find((c) => c.id === companyHigh)!;
    const ids = high.contacts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(high.sourceSummary.providers).toEqual(
      expect.arrayContaining(['SEARXNG', 'FIRECRAWL', 'KEELEAD']),
    );
    expect(high.sourceSummary.searchSources).toBeGreaterThanOrEqual(1);
    expect(high.sourceSummary.researchPages).toBeGreaterThanOrEqual(1);
    expect(high.sourceSummary.emailVerifications).toBeGreaterThanOrEqual(1);
  });

  it('rejects company detail org mismatch', async () => {
    await expect(
      getCompanyDetail({ organizationId: orgA, companyId: companyOrgB }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_MISMATCH' });
  });

  it('returns company detail with scores and safe sources', async () => {
    const detail = await getCompanyDetail({
      organizationId: orgA,
      companyId: companyHigh,
    });
    expect(detail.company.domain).toContain('mediserv-pool');
    expect(detail.contacts.length).toBeGreaterThanOrEqual(1);
    expect(detail.scores[0].searchTaskId).toBe(taskA);
    expect(detail.scores[0].taskPrompt).toContain('medical device');
    expect(detail.sources.length).toBeGreaterThan(0);
    expect(detail.sources[0]).toHaveProperty('excerpt');
    expect(JSON.stringify(detail)).not.toMatch(/markdown/i);
  });

  it('lists search tasks only for the organization', async () => {
    const listA = await listSearchTasks({
      organizationId: orgA,
      query: { page: 1, pageSize: 20 },
    });
    expect(listA.tasks.every((t) => t.id === taskA || t.id === taskB)).toBe(true);
    const item = listA.tasks.find((t) => t.id === taskA)!;
    expect(item.companyCount).toBe(3);
    expect(item.scoredCount).toBe(2);
    expect(item.gradeCounts.A).toBe(1);
    expect(item.gradeCounts.D).toBe(1);

    const listB = await listSearchTasks({
      organizationId: orgB,
      query: { page: 1, pageSize: 20 },
    });
    expect(listB.tasks.find((t) => t.id === taskA)).toBeUndefined();
  });

  it('returns a single search task for the owning org', async () => {
    const data = await getSearchTask({
      organizationId: orgA,
      searchTaskId: taskA,
    });
    expect(data.task.id).toBe(taskA);
    expect(data.task.status).toBeTruthy();
    expect(data.task.prompt).toContain('medical device');
    expect(data.task.createdAt).toBeTruthy();
    expect(data.task.companyCount).toBe(3);
    expect(data.task.scoredCount).toBe(2);
    expect(data.task.gradeCounts.A).toBe(1);
  });

  it('rejects org mismatch and missing search task', async () => {
    await expect(
      getSearchTask({ organizationId: orgB, searchTaskId: taskA }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_MISMATCH' } satisfies Partial<AppError>);

    await expect(
      getSearchTask({ organizationId: orgA, searchTaskId: 'does-not-exist' }),
    ).rejects.toMatchObject({ code: 'LEAD_SEARCH_TASK_NOT_FOUND' } satisfies Partial<AppError>);
  });
});
