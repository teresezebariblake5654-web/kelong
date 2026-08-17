import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';

describe('LeadScore schema constraints', () => {
  const suffix = Date.now();
  let orgId = '';
  let companyId = '';
  let taskA = '';
  let taskB = '';

  beforeAll(async () => {
    await connectDatabase();
    const org = await prisma.organization.create({
      data: { name: `Lead Score Org ${suffix}`, slug: `lead-score-${suffix}` },
    });
    orgId = org.id;

    const company = await prisma.leadCompany.create({
      data: {
        organizationId: orgId,
        domain: 'score-co.test',
        normalizedDomain: 'score-co.test',
        website: 'https://score-co.test/',
      },
    });
    companyId = company.id;

    const a = await prisma.leadSearchTask.create({
      data: {
        organizationId: orgId,
        prompt: 'german robot dog distributors',
        status: 'COMPLETED',
        targetCount: 5,
      },
    });
    const b = await prisma.leadSearchTask.create({
      data: {
        organizationId: orgId,
        prompt: 'saudi cardiac medical device distributors',
        status: 'COMPLETED',
        targetCount: 5,
      },
    });
    taskA = a.id;
    taskB = b.id;
  });

  afterAll(async () => {
    if (orgId) {
      await prisma.leadScore.deleteMany({ where: { organizationId: orgId } });
      await prisma.leadCompany.deleteMany({ where: { organizationId: orgId } });
      await prisma.leadSearchTask.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
    await disconnectDatabase();
  });

  it('rejects duplicate score for same searchTaskId + companyId', async () => {
    await prisma.leadScore.create({
      data: {
        organizationId: orgId,
        searchTaskId: taskA,
        companyId,
        overallScore: 92,
        grade: 'A',
        industryScore: 90,
        locationScore: 90,
        businessTypeScore: 90,
        productFitScore: 95,
        companyFitScore: 90,
        contactabilityScore: 80,
        scoringVersion: 'schema-v1',
      },
    });

    await expect(
      prisma.leadScore.create({
        data: {
          organizationId: orgId,
          searchTaskId: taskA,
          companyId,
          overallScore: 10,
          grade: 'D',
          industryScore: 10,
          locationScore: 10,
          businessTypeScore: 10,
          productFitScore: 10,
          companyFitScore: 10,
          contactabilityScore: 10,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows different search tasks to score the same company', async () => {
    const scoreB = await prisma.leadScore.create({
      data: {
        organizationId: orgId,
        searchTaskId: taskB,
        companyId,
        overallScore: 5,
        grade: 'D',
        industryScore: 5,
        locationScore: 5,
        businessTypeScore: 5,
        productFitScore: 5,
        companyFitScore: 5,
        contactabilityScore: 5,
        reasoning: { summary: 'wrong ICP for this task' },
        evidence: { signals: [] },
        modelProvider: null,
        modelName: null,
        scoringVersion: 'schema-v1',
      },
    });

    expect(scoreB.id).toBeTruthy();

    const scores = await prisma.leadScore.findMany({
      where: { companyId },
      orderBy: { overallScore: 'desc' },
    });
    expect(scores).toHaveLength(2);
    expect(scores.map((s) => s.searchTaskId).sort()).toEqual([taskA, taskB].sort());
    expect(scores.map((s) => s.overallScore).sort((a, b) => a - b)).toEqual([5, 92]);
  });
});
