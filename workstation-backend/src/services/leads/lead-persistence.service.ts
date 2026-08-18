/**
 * Lead Persistence Service
 *
 * Normalized Discovery Result → PostgreSQL only.
 * MUST NOT call SearXNG / Firecrawl / KeeLead (network stays in discovery).
 */

import { Prisma, type LeadCompany, type LeadContact, type LeadSearchTask } from '@prisma/client';
import { prisma } from '../../config/database';
import type {
  DiscoveryPreviewCompany,
  DiscoveryPreviewResult,
} from './lead-discovery.service';

export type PersistDiscoveryInput = {
  organizationId: string;
  searchTaskId: string;
  discovery: DiscoveryPreviewResult;
};

export type PersistDiscoveryStats = {
  savedCompanies: number;
  createdCompanies: number;
  updatedCompanies: number;
  createdContacts: number;
  updatedContacts: number;
  sourceRecords: number;
};

export type PersistDiscoveryCompanyResult = {
  id: string;
  domain: string;
  normalizedDomain: string;
  website: string | null;
  candidateKind: string;
  contacts: Array<{
    id: string;
    email: string | null;
    emailNormalized: string | null;
    emailVerificationStatus: string | null;
    emailVerificationScore: number | null;
  }>;
};

export type PersistDiscoveryResult = {
  stats: PersistDiscoveryStats;
  companies: PersistDiscoveryCompanyResult[];
  errors: Array<{ domain?: string; message: string; code: string }>;
};

export function normalizeLeadDomain(domainOrUrl: string): string {
  const raw = domainOrUrl.trim().toLowerCase();
  try {
    if (raw.includes('://')) {
      const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
      return host;
    }
  } catch {
    // fall through
  }
  return raw.replace(/^www\./, '').replace(/\/.*$/, '');
}

export function normalizeLeadEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Never overwrite existing non-empty values with null/empty. */
export function mergeStringField(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  if (isNonEmptyString(incoming)) return incoming.trim();
  if (isNonEmptyString(existing)) return existing!.trim();
  return null;
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function dedupeStringList(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function firstSocialUrl(
  items: Array<{ url: string; sourceUrl?: string }>,
): string | null {
  const hit = items.find((i) => isNonEmptyString(i.url));
  return hit ? hit.url.trim() : null;
}

function companyMetadataFromDiscovery(
  company: DiscoveryPreviewCompany,
  existing?: Record<string, unknown>,
): Prisma.InputJsonValue {
  const prev = existing ?? {};
  const prevPhones = Array.isArray(prev.discoveredPhones)
    ? (prev.discoveredPhones as unknown[]).map(String)
    : [];
  const nextPhones = company.contacts.phones.map((p) => p.phone);

  return {
    ...prev,
    leadStage: 'candidate',
    candidateKind: company.candidateKind,
    searchTitle: company.search.title || null,
    searchDescription: company.search.description || null,
    searchEngine: company.search.engine || null,
    searchQuery: company.search.query || null,
    searchQueries: Array.isArray(company.search.queries) ? company.search.queries : [],
    researchedPages: company.researchedPages,
    websiteResearchTitle: company.websiteResearch?.title ?? null,
    discoveredPhones: dedupeStringList([...prevPhones, ...nextPhones]),
    discoveredSocial: {
      linkedin: dedupeStringList(company.contacts.linkedin.map((x) => x.url)),
      facebook: dedupeStringList(company.contacts.facebook.map((x) => x.url)),
      instagram: dedupeStringList(company.contacts.instagram.map((x) => x.url)),
    },
    // Explicit: not a qualified customer / ICP decision.
    qualification: 'undecided_candidate',
  };
}

async function findExistingSourceRecord(params: {
  searchTaskId: string;
  provider: string;
  sourceType: string;
  sourceUrl: string | null;
  companyId: string | null;
  contactId: string | null;
}): Promise<string | null> {
  const existing = await prisma.leadSourceRecord.findFirst({
    where: {
      searchTaskId: params.searchTaskId,
      provider: params.provider,
      sourceType: params.sourceType,
      sourceUrl: params.sourceUrl,
      companyId: params.companyId,
      contactId: params.contactId,
    },
    select: { id: true },
  });
  return existing?.id ?? null;
}

async function createSourceRecordIfAbsent(params: {
  organizationId: string;
  searchTaskId: string;
  companyId?: string | null;
  contactId?: string | null;
  provider: string;
  sourceType: string;
  sourceUrl?: string | null;
  rawData?: Prisma.InputJsonValue;
}): Promise<boolean> {
  const companyId = params.companyId ?? null;
  const contactId = params.contactId ?? null;
  const sourceUrl = params.sourceUrl ?? null;

  const existingId = await findExistingSourceRecord({
    searchTaskId: params.searchTaskId,
    provider: params.provider,
    sourceType: params.sourceType,
    sourceUrl,
    companyId,
    contactId,
  });
  if (existingId) return false;

  await prisma.leadSourceRecord.create({
    data: {
      organizationId: params.organizationId,
      searchTaskId: params.searchTaskId,
      companyId,
      contactId,
      provider: params.provider,
      sourceType: params.sourceType,
      sourceUrl,
      rawData: params.rawData ?? undefined,
      retrievedAt: new Date(),
    },
  });
  return true;
}

type TxClient = Prisma.TransactionClient;

async function upsertCompanyInTx(
  tx: TxClient,
  organizationId: string,
  company: DiscoveryPreviewCompany,
): Promise<{ row: LeadCompany; created: boolean }> {
  const normalizedDomain = normalizeLeadDomain(company.domain);
  const existing = await tx.leadCompany.findUnique({
    where: {
      organizationId_normalizedDomain: {
        organizationId,
        normalizedDomain,
      },
    },
  });

  const website = mergeStringField(existing?.website, company.website || homepageFallback(normalizedDomain));
  const linkedinUrl = mergeStringField(
    existing?.linkedinUrl,
    firstSocialUrl(company.contacts.linkedin),
  );
  const facebookUrl = mergeStringField(
    existing?.facebookUrl,
    firstSocialUrl(company.contacts.facebook),
  );
  const instagramUrl = mergeStringField(
    existing?.instagramUrl,
    firstSocialUrl(company.contacts.instagram),
  );

  // No reliable companyName from discovery — do not invent from domain / search title.
  const name = mergeStringField(existing?.name, null);

  const metadata = companyMetadataFromDiscovery(
    company,
    asJsonObject(existing?.metadata),
  );

  if (!existing) {
    const row = await tx.leadCompany.create({
      data: {
        organizationId,
        name,
        domain: normalizedDomain,
        normalizedDomain,
        website,
        linkedinUrl,
        facebookUrl,
        instagramUrl,
        metadata,
      },
    });
    return { row, created: true };
  }

  const row = await tx.leadCompany.update({
    where: { id: existing.id },
    data: {
      name,
      website,
      linkedinUrl,
      facebookUrl,
      instagramUrl,
      metadata,
      // domain display stays normalized; never invent.
      domain: existing.domain || normalizedDomain,
    },
  });
  return { row, created: false };
}

function homepageFallback(normalizedDomain: string): string {
  return `https://${normalizedDomain}/`;
}

async function upsertEmailContactInTx(
  tx: TxClient,
  params: {
    organizationId: string;
    companyId: string;
    email: string;
    verification: Record<string, unknown> | null;
  },
): Promise<{ row: LeadContact; created: boolean }> {
  const emailNormalized = normalizeLeadEmail(params.email);
  const existing = await tx.leadContact.findFirst({
    where: {
      organizationId: params.organizationId,
      companyId: params.companyId,
      emailNormalized,
    },
  });

  const status =
    params.verification && typeof params.verification.status === 'string'
      ? params.verification.status
      : null;
  const scoreRaw = params.verification?.score;
  const score =
    typeof scoreRaw === 'number' && Number.isFinite(scoreRaw) ? Math.round(scoreRaw) : null;

  if (!existing) {
    const row = await tx.leadContact.create({
      data: {
        organizationId: params.organizationId,
        companyId: params.companyId,
        email: emailNormalized,
        emailNormalized,
        emailVerificationStatus: status,
        emailVerificationScore: score,
        metadata: {
          source: 'discovery',
          verification: params.verification,
        } as Prisma.InputJsonValue,
      },
    });
    return { row, created: true };
  }

  const row = await tx.leadContact.update({
    where: { id: existing.id },
    data: {
      email: mergeStringField(existing.email, emailNormalized),
      emailNormalized,
      emailVerificationStatus: mergeStringField(existing.emailVerificationStatus, status),
      emailVerificationScore:
        score !== null ? score : existing.emailVerificationScore,
      metadata: {
        ...asJsonObject(existing.metadata),
        source: 'discovery',
        verification: params.verification ?? asJsonObject(existing.metadata).verification ?? null,
      },
    },
  });
  return { row, created: false };
}

async function persistOneCompany(params: {
  organizationId: string;
  searchTaskId: string;
  company: DiscoveryPreviewCompany;
}): Promise<{
  company: PersistDiscoveryCompanyResult;
  createdCompany: boolean;
  createdContacts: number;
  updatedContacts: number;
  sourceRecords: number;
}> {
  const { organizationId, searchTaskId, company } = params;
  let createdContacts = 0;
  let updatedContacts = 0;
  let sourceRecords = 0;
  const contactResults: PersistDiscoveryCompanyResult['contacts'] = [];

  const { row: companyRow, created: createdCompany } = await prisma.$transaction(async (tx) => {
    const upserted = await upsertCompanyInTx(tx, organizationId, company);
    return upserted;
  });

  // Source records outside the company upsert tx is OK; still per-company scoped.
  // Prefer short txs: company first, then sources/contacts with their own short txs.

  const searxCreated = await createSourceRecordIfAbsent({
    organizationId,
    searchTaskId,
    companyId: companyRow.id,
    provider: 'SEARXNG',
    sourceType: 'WEB_SEARCH',
    sourceUrl: company.website || homepageFallback(companyRow.normalizedDomain),
    rawData: {
      title: company.search.title,
      description: company.search.description,
      engine: company.search.engine,
      candidateKind: company.candidateKind,
      domain: company.domain,
      searchQuery: company.search.query || null,
      searchQueries: Array.isArray(company.search.queries) ? company.search.queries : [],
    },
  });
  if (searxCreated) sourceRecords += 1;

  for (const pageUrl of company.researchedPages) {
    const created = await createSourceRecordIfAbsent({
      organizationId,
      searchTaskId,
      companyId: companyRow.id,
      provider: 'FIRECRAWL',
      sourceType: 'WEBSITE_RESEARCH',
      sourceUrl: pageUrl,
      rawData: {
        title: company.websiteResearch?.title ?? null,
        pageUrl,
        emailCount: company.contacts.emails.length,
        phoneCount: company.contacts.phones.length,
        socialCount:
          company.contacts.linkedin.length +
          company.contacts.facebook.length +
          company.contacts.instagram.length,
        // Intentionally omit full markdown.
      },
    });
    if (created) sourceRecords += 1;
  }

  for (const emailItem of company.contacts.emails) {
    if (!isNonEmptyString(emailItem.email)) continue;

    const { row: contactRow, created } = await prisma.$transaction(async (tx) =>
      upsertEmailContactInTx(tx, {
        organizationId,
        companyId: companyRow.id,
        email: emailItem.email,
        verification: emailItem.verification,
      }),
    );

    if (created) createdContacts += 1;
    else updatedContacts += 1;

    contactResults.push({
      id: contactRow.id,
      email: contactRow.email,
      emailNormalized: contactRow.emailNormalized,
      emailVerificationStatus: contactRow.emailVerificationStatus,
      emailVerificationScore: contactRow.emailVerificationScore,
    });

    const keeleadCreated = await createSourceRecordIfAbsent({
      organizationId,
      searchTaskId,
      companyId: companyRow.id,
      contactId: contactRow.id,
      provider: 'KEELEAD',
      sourceType: 'EMAIL_VERIFICATION',
      sourceUrl: emailItem.sourceUrl ?? null,
      rawData: {
        email: normalizeLeadEmail(emailItem.email),
        verification: emailItem.verification,
      } as Prisma.InputJsonValue,
    });
    if (keeleadCreated) sourceRecords += 1;
  }

  return {
    company: {
      id: companyRow.id,
      domain: companyRow.domain,
      normalizedDomain: companyRow.normalizedDomain,
      website: companyRow.website,
      candidateKind: company.candidateKind,
      contacts: contactResults,
    },
    createdCompany,
    createdContacts,
    updatedContacts,
    sourceRecords,
  };
}

/**
 * Persist a completed discovery preview into PostgreSQL.
 * Call only AFTER all network I/O has finished.
 */
export async function persistDiscoveryResult(
  input: PersistDiscoveryInput,
): Promise<PersistDiscoveryResult> {
  const stats: PersistDiscoveryStats = {
    savedCompanies: 0,
    createdCompanies: 0,
    updatedCompanies: 0,
    createdContacts: 0,
    updatedContacts: 0,
    sourceRecords: 0,
  };
  const companies: PersistDiscoveryCompanyResult[] = [];
  const errors: PersistDiscoveryResult['errors'] = [];

  for (const company of input.discovery.companies) {
    // Skip companies with zero researched pages AND no website research — still allow
    // candidates that were researched (even directory_likely) per product rules.
    if (!company.domain) {
      errors.push({
        code: 'PERSIST_SKIP_NO_DOMAIN',
        message: 'Company missing domain',
      });
      continue;
    }

    try {
      const result = await persistOneCompany({
        organizationId: input.organizationId,
        searchTaskId: input.searchTaskId,
        company,
      });
      stats.savedCompanies += 1;
      if (result.createdCompany) stats.createdCompanies += 1;
      else stats.updatedCompanies += 1;
      stats.createdContacts += result.createdContacts;
      stats.updatedContacts += result.updatedContacts;
      stats.sourceRecords += result.sourceRecords;
      companies.push(result.company);
    } catch (err) {
      errors.push({
        domain: company.domain,
        code: 'PERSIST_COMPANY_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { stats, companies, errors };
}

export async function createPendingSearchTask(params: {
  organizationId: string;
  prompt: string;
  targetCount: number;
}): Promise<LeadSearchTask> {
  return prisma.leadSearchTask.create({
    data: {
      organizationId: params.organizationId,
      prompt: params.prompt,
      status: 'PENDING',
      targetCount: params.targetCount,
    },
  });
}

export async function createRunningSearchTask(params: {
  organizationId: string;
  prompt: string;
  targetCount: number;
}): Promise<LeadSearchTask> {
  return prisma.leadSearchTask.create({
    data: {
      organizationId: params.organizationId,
      prompt: params.prompt,
      status: 'RUNNING',
      targetCount: params.targetCount,
      startedAt: new Date(),
    },
  });
}

export async function markSearchTaskRunning(taskId: string): Promise<LeadSearchTask> {
  const existing = await prisma.leadSearchTask.findUnique({ where: { id: taskId } });
  return prisma.leadSearchTask.update({
    where: { id: taskId },
    data: {
      status: 'RUNNING',
      startedAt: existing?.startedAt ?? new Date(),
    },
  });
}

export async function completeSearchTask(params: {
  taskId: string;
  discovery: DiscoveryPreviewResult;
  persistStats: PersistDiscoveryStats;
  agentSummary?: Record<string, unknown>;
  extraMetadata?: Record<string, unknown>;
}): Promise<LeadSearchTask> {
  const existing = await prisma.leadSearchTask.findUnique({ where: { id: params.taskId } });
  if (!existing) {
    throw new Error(`LeadSearchTask not found: ${params.taskId}`);
  }
  // Never overwrite CANCELLED with COMPLETED.
  if (existing.status === 'CANCELLED' || existing.cancelRequestedAt) {
    if (existing.status !== 'CANCELLED') {
      return prisma.leadSearchTask.update({
        where: { id: params.taskId },
        data: {
          status: 'CANCELLED',
          completedAt: existing.completedAt ?? new Date(),
        },
      });
    }
    return existing;
  }

  const prevMeta =
    existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
      ? (existing.metadata as Record<string, unknown>)
      : {};

  return prisma.leadSearchTask.update({
    where: { id: params.taskId },
    data: {
      status: 'COMPLETED',
      searchResultsCount: params.discovery.stats.searchResults,
      uniqueDomainsCount: params.discovery.stats.uniqueDomains,
      researchedCount: params.discovery.stats.researched,
      successfulCount: params.discovery.stats.successful,
      completedAt: new Date(),
      metadata: {
        ...prevMeta,
        persist: params.persistStats,
        pagesScraped: params.discovery.stats.pagesScraped,
        keeleadVerifyCalls: params.discovery.stats.keeleadVerifyCalls,
        durationMs: params.discovery.durationMs,
        ...(params.agentSummary ? { acquisitionAgent: params.agentSummary } : {}),
        ...(params.extraMetadata ?? {}),
      } as Prisma.InputJsonValue,
    },
  });
}

export async function failSearchTask(params: {
  taskId: string;
  error: unknown;
}): Promise<LeadSearchTask | null> {
  const message = params.error instanceof Error ? params.error.message : String(params.error);
  try {
    const existing = await prisma.leadSearchTask.findUnique({ where: { id: params.taskId } });
    if (!existing) return null;
    // Terminal: never overwrite CANCELLED with FAILED.
    if (existing.status === 'CANCELLED' || existing.cancelRequestedAt) {
      if (existing.status !== 'CANCELLED') {
        return prisma.leadSearchTask.update({
          where: { id: params.taskId },
          data: {
            status: 'CANCELLED',
            completedAt: existing.completedAt ?? new Date(),
          },
        });
      }
      return existing;
    }
    if (existing.status === 'COMPLETED' || existing.status === 'FAILED') {
      return existing;
    }
    return await prisma.leadSearchTask.update({
      where: { id: params.taskId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        metadata: {
          error: message,
          failedAt: new Date().toISOString(),
        },
      },
    });
  } catch {
    // Best-effort: do not mask the original discovery/persist failure.
    return null;
  }
}

export const leadPersistenceService = {
  persistDiscoveryResult,
  createPendingSearchTask,
  createRunningSearchTask,
  markSearchTaskRunning,
  completeSearchTask,
  failSearchTask,
  normalizeLeadDomain,
  normalizeLeadEmail,
  mergeStringField,
};
