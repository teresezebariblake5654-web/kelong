/**
 * Read-only lead resource pool APIs (search tasks / companies / contacts / scores).
 * No create/update/upsert/delete.
 */

import type {
  LeadCompany,
  LeadContact,
  LeadScore,
  LeadSourceRecord,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/errors';
import { publicProgress, type LeadTaskProgress } from './lead-task-progress.types';
import type {
  LeadPoolCompanyDetailDto,
  LeadPoolCompanyResultDto,
  LeadPoolContactDto,
  LeadPoolScoreDto,
  LeadPoolSearchTaskDetailDto,
  LeadPoolSearchTaskListDto,
  LeadPoolSourceProvenanceDto,
  LeadPoolSourceSummaryDto,
  LeadPoolTaskResultsDto,
  SearchTaskListQuery,
  SearchTaskResultsQuery,
} from './lead-pool.types';

type CompanyWithRelations = LeadCompany & {
  contacts: LeadContact[];
  scores: LeadScore[];
  sourceRecords: Array<Pick<LeadSourceRecord, 'provider' | 'sourceType'>>;
};

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t ? t : null;
}

function toIso(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString();
}

function mapContact(c: LeadContact): LeadPoolContactDto {
  return {
    id: c.id,
    fullName: c.fullName,
    jobTitle: c.jobTitle,
    email: c.email,
    emailVerificationStatus: c.emailVerificationStatus,
    emailVerificationScore: c.emailVerificationScore,
    phone: c.phone,
    whatsapp: c.whatsapp,
    linkedinUrl: c.linkedinUrl,
    facebookUrl: c.facebookUrl,
    instagramUrl: c.instagramUrl,
  };
}

function mapScore(score: LeadScore | undefined | null): LeadPoolScoreDto | null {
  if (!score) return null;
  const reasoning = score.reasoning ? asObject(score.reasoning) : null;
  const evidence = Array.isArray(score.evidence) ? score.evidence : [];
  return {
    overallScore: score.overallScore,
    grade: score.grade,
    industryScore: score.industryScore,
    locationScore: score.locationScore,
    businessTypeScore: score.businessTypeScore,
    productFitScore: score.productFitScore,
    companyFitScore: score.companyFitScore,
    contactabilityScore: score.contactabilityScore,
    reasoning,
    evidence,
  };
}

function companyHasEmail(contacts: LeadContact[]): boolean {
  return contacts.some((c) => !!(c.emailNormalized || c.email)?.trim());
}

function companyHasPhone(company: LeadCompany, contacts: LeadContact[]): boolean {
  if (contacts.some((c) => !!(c.phone || c.whatsapp)?.trim())) return true;
  const meta = asObject(company.metadata);
  const discovered = Array.isArray(meta.discoveredPhones) ? meta.discoveredPhones : [];
  return discovered.some((p) => typeof p === 'string' && p.trim().length > 0);
}

function buildSourceSummary(
  records: Array<Pick<LeadSourceRecord, 'provider' | 'sourceType'>>,
): LeadPoolSourceSummaryDto {
  const providers = [...new Set(records.map((r) => r.provider))].sort();
  let searchSources = 0;
  let researchPages = 0;
  let emailVerifications = 0;
  for (const r of records) {
    if (r.provider === 'SEARXNG' || r.sourceType === 'WEB_SEARCH') searchSources += 1;
    else if (r.provider === 'FIRECRAWL' || r.sourceType === 'WEBSITE_RESEARCH') researchPages += 1;
    else if (r.provider === 'KEELEAD' || r.sourceType === 'EMAIL_VERIFICATION') {
      emailVerifications += 1;
    }
  }
  return { providers, searchSources, researchPages, emailVerifications };
}

function extractSourceExcerpt(rawData: unknown): {
  title: string | null;
  description: string | null;
  pageTitle: string | null;
} {
  const raw = asObject(rawData);
  return {
    title: asStringOrNull(raw.title) ?? asStringOrNull(raw.searchTitle),
    description: asStringOrNull(raw.description) ?? asStringOrNull(raw.searchDescription),
    pageTitle:
      asStringOrNull(raw.pageTitle) ??
      asStringOrNull(raw.websiteResearchTitle) ??
      asStringOrNull(asObject(raw.metadata).title),
  };
}

function mapSourceProvenance(
  record: Pick<
    LeadSourceRecord,
    'id' | 'provider' | 'sourceType' | 'sourceUrl' | 'retrievedAt' | 'createdAt' | 'rawData'
  >,
): LeadPoolSourceProvenanceDto {
  return {
    id: record.id,
    provider: record.provider,
    sourceType: record.sourceType,
    sourceUrl: record.sourceUrl,
    retrievedAt: record.retrievedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    excerpt: extractSourceExcerpt(record.rawData),
  };
}

function mapCompanyResult(company: CompanyWithRelations): LeadPoolCompanyResultDto {
  const score = company.scores[0] ?? null;
  // Deduplicate contacts by id (defensive; Prisma include should already be unique).
  const contactMap = new Map<string, LeadContact>();
  for (const c of company.contacts) contactMap.set(c.id, c);

  return {
    id: company.id,
    name: company.name,
    domain: company.domain,
    website: company.website,
    country: company.country,
    city: company.city,
    industry: company.industry,
    description: company.description,
    social: {
      linkedin: company.linkedinUrl,
      facebook: company.facebookUrl,
      instagram: company.instagramUrl,
    },
    score: mapScore(score),
    contacts: [...contactMap.values()].map(mapContact),
    sourceSummary: buildSourceSummary(company.sourceRecords),
  };
}

function matchesTextQuery(company: LeadCompany, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    company.name,
    company.domain,
    company.website,
    company.country,
    company.city,
    company.industry,
    company.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(needle);
}

function applyResultFilters(
  rows: LeadPoolCompanyResultDto[],
  companyById: Map<string, CompanyWithRelations>,
  query: SearchTaskResultsQuery,
): LeadPoolCompanyResultDto[] {
  return rows.filter((row) => {
    const company = companyById.get(row.id);
    if (!company) return false;

    if (query.grade) {
      if (query.grade === 'UNSCORED') {
        // No LeadScore for this SearchTask + Company (other tasks do not count).
        if (row.score) return false;
      } else if (!row.score || row.score.grade !== query.grade) {
        return false;
      }
    }
    if (query.minScore !== undefined) {
      if (!row.score || row.score.overallScore < query.minScore) return false;
    }
    if (query.maxScore !== undefined) {
      if (!row.score || row.score.overallScore > query.maxScore) return false;
    }
    if (query.hasEmail === true && !companyHasEmail(company.contacts)) return false;
    if (query.hasPhone === true && !companyHasPhone(company, company.contacts)) return false;
    if (query.q && !matchesTextQuery(company, query.q)) return false;
    return true;
  });
}

/** Scored first by overallScore DESC; unscored last; ties by company.updatedAt DESC. */
export function sortCompanyResults(
  rows: LeadPoolCompanyResultDto[],
  updatedAtById: Map<string, Date>,
): LeadPoolCompanyResultDto[] {
  return [...rows].sort((a, b) => {
    const aScored = a.score != null;
    const bScored = b.score != null;
    if (aScored !== bScored) return aScored ? -1 : 1;
    if (aScored && bScored) {
      const diff = b.score!.overallScore - a.score!.overallScore;
      if (diff !== 0) return diff;
    }
    const aUpdated = updatedAtById.get(a.id)?.getTime() ?? 0;
    const bUpdated = updatedAtById.get(b.id)?.getTime() ?? 0;
    return bUpdated - aUpdated;
  });
}

function emptyGradeCounts() {
  return { A: 0, B: 0, C: 0, D: 0, UNSCORED: 0 };
}

function buildTaskSummary(rows: LeadPoolCompanyResultDto[], companyById: Map<string, CompanyWithRelations>) {
  const grades = emptyGradeCounts();
  let scored = 0;
  let withEmail = 0;
  let withPhone = 0;
  for (const row of rows) {
    if (row.score) {
      scored += 1;
      grades[row.score.grade] += 1;
    } else {
      grades.UNSCORED += 1;
    }
    const company = companyById.get(row.id);
    if (company) {
      if (companyHasEmail(company.contacts)) withEmail += 1;
      if (companyHasPhone(company, company.contacts)) withPhone += 1;
    }
  }
  return {
    total: rows.length,
    scored,
    grades,
    withEmail,
    withPhone,
  };
}

async function loadTaskCompanies(params: {
  organizationId: string;
  searchTaskId: string;
}): Promise<{ task: Awaited<ReturnType<typeof prisma.leadSearchTask.findFirst>>; companies: CompanyWithRelations[] }> {
  const task = await prisma.leadSearchTask.findFirst({
    where: { id: params.searchTaskId },
  });
  if (!task) {
    throw new AppError(404, '获客任务不存在', 'LEAD_SEARCH_TASK_NOT_FOUND');
  }
  if (task.organizationId !== params.organizationId) {
    throw new AppError(403, '无权访问该获客任务', 'ORGANIZATION_MISMATCH');
  }

  const linked = await prisma.leadSourceRecord.findMany({
    where: {
      searchTaskId: params.searchTaskId,
      organizationId: params.organizationId,
      companyId: { not: null },
    },
    select: { companyId: true },
    distinct: ['companyId'],
  });
  const companyIds = linked
    .map((r) => r.companyId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (companyIds.length === 0) {
    return { task, companies: [] };
  }

  const companies = await prisma.leadCompany.findMany({
    where: {
      id: { in: companyIds },
      organizationId: params.organizationId,
    },
    include: {
      contacts: true,
      scores: {
        where: { searchTaskId: params.searchTaskId },
        take: 1,
      },
      sourceRecords: {
        where: { searchTaskId: params.searchTaskId },
        select: {
          provider: true,
          sourceType: true,
        },
      },
    },
  });

  return { task, companies };
}

export async function getSearchTaskResults(params: {
  organizationId: string;
  searchTaskId: string;
  query: SearchTaskResultsQuery;
}): Promise<LeadPoolTaskResultsDto> {
  const { task, companies } = await loadTaskCompanies({
    organizationId: params.organizationId,
    searchTaskId: params.searchTaskId,
  });
  if (!task) {
    throw new AppError(404, '获客任务不存在', 'LEAD_SEARCH_TASK_NOT_FOUND');
  }

  const companyById = new Map(companies.map((c) => [c.id, c]));
  const updatedAtById = new Map(companies.map((c) => [c.id, c.updatedAt]));
  const allRows = companies.map(mapCompanyResult);
  const summary = buildTaskSummary(allRows, companyById);

  const filtered = applyResultFilters(allRows, companyById, params.query);
  const sorted = sortCompanyResults(filtered, updatedAtById);

  const page = params.query.page;
  const pageSize = params.query.pageSize;
  const total = sorted.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const pageRows = sorted.slice(start, start + pageSize);

  // Strip rawData from response mapping (already not exposed in DTO).
  return {
    task: {
      id: task.id,
      prompt: task.prompt,
      status: task.status,
      createdAt: task.createdAt.toISOString(),
      completedAt: toIso(task.completedAt),
    },
    summary,
    pagination: { page, pageSize, total, totalPages },
    companies: pageRows,
  };
}

export async function getCompanyDetail(params: {
  organizationId: string;
  companyId: string;
}): Promise<LeadPoolCompanyDetailDto> {
  const company = await prisma.leadCompany.findFirst({
    where: { id: params.companyId },
    include: {
      contacts: true,
      scores: {
        include: {
          searchTask: { select: { id: true, prompt: true } },
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      },
      sourceRecords: {
        orderBy: { retrievedAt: 'desc' },
        select: {
          id: true,
          provider: true,
          sourceType: true,
          sourceUrl: true,
          retrievedAt: true,
          createdAt: true,
          rawData: true,
        },
      },
    },
  });

  if (!company) {
    throw new AppError(404, '公司不存在', 'LEAD_COMPANY_NOT_FOUND');
  }
  if (company.organizationId !== params.organizationId) {
    throw new AppError(403, '无权访问该公司', 'ORGANIZATION_MISMATCH');
  }

  const contactMap = new Map<string, LeadContact>();
  for (const c of company.contacts) contactMap.set(c.id, c);

  return {
    company: {
      id: company.id,
      name: company.name,
      domain: company.domain,
      website: company.website,
      country: company.country,
      city: company.city,
      industry: company.industry,
      description: company.description,
      social: {
        linkedin: company.linkedinUrl,
        facebook: company.facebookUrl,
        instagram: company.instagramUrl,
      },
      createdAt: company.createdAt.toISOString(),
      updatedAt: company.updatedAt.toISOString(),
    },
    contacts: [...contactMap.values()].map(mapContact),
    scores: company.scores.map((s) => ({
      id: s.id,
      searchTaskId: s.searchTaskId,
      taskPrompt: s.searchTask?.prompt ?? null,
      overallScore: s.overallScore,
      grade: s.grade,
      industryScore: s.industryScore,
      locationScore: s.locationScore,
      businessTypeScore: s.businessTypeScore,
      productFitScore: s.productFitScore,
      companyFitScore: s.companyFitScore,
      contactabilityScore: s.contactabilityScore,
      reasoning: s.reasoning ? asObject(s.reasoning) : null,
      evidence: Array.isArray(s.evidence) ? s.evidence : [],
      scoringVersion: s.scoringVersion,
      modelProvider: s.modelProvider,
      modelName: s.modelName,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
    sources: company.sourceRecords.map(mapSourceProvenance),
  };
}

export async function listSearchTasks(params: {
  organizationId: string;
  query: SearchTaskListQuery;
}): Promise<LeadPoolSearchTaskListDto> {
  const { page, pageSize } = params.query;
  const where: Prisma.LeadSearchTaskWhereInput = {
    organizationId: params.organizationId,
  };

  const [total, tasks] = await Promise.all([
    prisma.leadSearchTask.count({ where }),
    prisma.leadSearchTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const taskIds = tasks.map((t) => t.id);
  const companyCountByTask = new Map<string, number>();
  const gradeCountsByTask = new Map<
    string,
    { A: number; B: number; C: number; D: number }
  >();
  const scoredCountByTask = new Map<string, number>();

  for (const id of taskIds) {
    companyCountByTask.set(id, 0);
    gradeCountsByTask.set(id, { A: 0, B: 0, C: 0, D: 0 });
    scoredCountByTask.set(id, 0);
  }

  if (taskIds.length > 0) {
    const [linkedPairs, gradeGroups] = await Promise.all([
      prisma.leadSourceRecord.groupBy({
        by: ['searchTaskId', 'companyId'],
        where: {
          organizationId: params.organizationId,
          searchTaskId: { in: taskIds },
          companyId: { not: null },
        },
      }),
      prisma.leadScore.groupBy({
        by: ['searchTaskId', 'grade'],
        where: {
          organizationId: params.organizationId,
          searchTaskId: { in: taskIds },
        },
        _count: { _all: true },
      }),
    ]);

    for (const row of linkedPairs) {
      if (!row.searchTaskId || !row.companyId) continue;
      companyCountByTask.set(
        row.searchTaskId,
        (companyCountByTask.get(row.searchTaskId) ?? 0) + 1,
      );
    }

    for (const row of gradeGroups) {
      const counts = gradeCountsByTask.get(row.searchTaskId) ?? { A: 0, B: 0, C: 0, D: 0 };
      counts[row.grade] = row._count._all;
      gradeCountsByTask.set(row.searchTaskId, counts);
      scoredCountByTask.set(
        row.searchTaskId,
        (scoredCountByTask.get(row.searchTaskId) ?? 0) + row._count._all,
      );
    }
  }

  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

  return {
    pagination: { page, pageSize, total, totalPages },
    tasks: tasks.map((t) => ({
      id: t.id,
      prompt: t.prompt,
      status: t.status,
      targetCount: t.targetCount,
      searchResultsCount: t.searchResultsCount,
      uniqueDomainsCount: t.uniqueDomainsCount,
      researchedCount: t.researchedCount,
      successfulCount: t.successfulCount,
      createdAt: t.createdAt.toISOString(),
      completedAt: toIso(t.completedAt),
      companyCount: companyCountByTask.get(t.id) ?? 0,
      scoredCount: scoredCountByTask.get(t.id) ?? 0,
      gradeCounts: gradeCountsByTask.get(t.id) ?? { A: 0, B: 0, C: 0, D: 0 },
    })),
  };
}

export async function getSearchTask(params: {
  organizationId: string;
  searchTaskId: string;
}): Promise<{ task: LeadPoolSearchTaskDetailDto }> {
  const task = await prisma.leadSearchTask.findFirst({
    where: { id: params.searchTaskId },
  });
  if (!task) {
    throw new AppError(404, '获客任务不存在', 'LEAD_SEARCH_TASK_NOT_FOUND');
  }
  if (task.organizationId !== params.organizationId) {
    throw new AppError(403, '无权访问该获客任务', 'ORGANIZATION_MISMATCH');
  }

  const [linkedPairs, gradeGroups] = await Promise.all([
    prisma.leadSourceRecord.groupBy({
      by: ['searchTaskId', 'companyId'],
      where: {
        organizationId: params.organizationId,
        searchTaskId: task.id,
        companyId: { not: null },
      },
    }),
    prisma.leadScore.groupBy({
      by: ['searchTaskId', 'grade'],
      where: {
        organizationId: params.organizationId,
        searchTaskId: task.id,
      },
      _count: { _all: true },
    }),
  ]);

  const companyCount = linkedPairs.filter((row) => row.companyId).length;
  const gradeCounts = { A: 0, B: 0, C: 0, D: 0 };
  let scoredCount = 0;
  for (const row of gradeGroups) {
    gradeCounts[row.grade] = row._count._all;
    scoredCount += row._count._all;
  }

  const meta = asObject(task.metadata);
  const errorMessage = asStringOrNull(meta.error);
  const progressRaw = asObject(meta.progress) as Partial<LeadTaskProgress>;
  const outcomeRaw = asObject(meta.outcome);

  return {
    task: {
      id: task.id,
      prompt: task.prompt,
      status: task.status,
      targetCount: task.targetCount,
      searchResultsCount: task.searchResultsCount,
      uniqueDomainsCount: task.uniqueDomainsCount,
      researchedCount: task.researchedCount,
      successfulCount: task.successfulCount,
      createdAt: task.createdAt.toISOString(),
      completedAt: toIso(task.completedAt),
      companyCount,
      scoredCount,
      gradeCounts,
      startedAt: toIso(task.startedAt),
      errorMessage,
      cancelRequestedAt: toIso(task.cancelRequestedAt),
      cancelledAt: toIso(task.cancelledAt),
      progress: publicProgress(
        progressRaw.phase ? (progressRaw as LeadTaskProgress) : null,
      ),
      outcome:
        typeof outcomeRaw.requestedTarget === 'number'
          ? {
              requestedTarget: outcomeRaw.requestedTarget as number,
              acquiredCompanies:
                typeof outcomeRaw.acquiredCompanies === 'number'
                  ? outcomeRaw.acquiredCompanies
                  : 0,
              targetReached: Boolean(outcomeRaw.targetReached),
              stopReason:
                typeof outcomeRaw.stopReason === 'string' ? outcomeRaw.stopReason : '',
            }
          : null,
    },
  };
}

export const leadPoolService = {
  getSearchTaskResults,
  getCompanyDetail,
  listSearchTasks,
  getSearchTask,
  sortCompanyResults,
};
