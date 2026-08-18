import { AppError } from '../../utils/errors';
import { env } from '../../config/env';
import { searxngProvider } from '../../providers/lead-engines/searxng.provider';
import { firecrawlProvider } from '../../providers/lead-engines/firecrawl.provider';
import { keeleadProvider } from '../../providers/lead-engines/keelead.provider';
import type { LeadProviderError, SearxngSearchHit } from '../../providers/lead-engines/lead-provider.types';
import { mapWithConcurrency } from '../../utils/map-with-concurrency';
import { isLeadTaskCancelledError, LeadTaskCancelledError } from './lead-task-cancelled.error';
import {
  extractContactsFromText,
  mergeExtractedContacts,
  type ExtractedContacts,
} from './lead-normalizer.service';

export const SEARCH_CANDIDATE_CAP = 20;
const DEFAULT_MAX_RESEARCH = 5;
const MAX_RESEARCH_HARD = 5;
const MAX_EMAILS_PER_COMPANY = 3;
const MAX_PAGES_PER_COMPANY = 3;
export const LEAD_RESEARCH_CONCURRENCY_HARD_MAX = 5;
export const LEAD_EMAIL_VERIFY_CONCURRENCY_HARD_MAX = 8;

export function resolveResearchConcurrency(): number {
  return Math.min(
    Math.max(env.leadResearchConcurrency || 3, 1),
    LEAD_RESEARCH_CONCURRENCY_HARD_MAX,
  );
}

export function resolveEmailVerifyConcurrency(): number {
  return Math.min(
    Math.max(env.leadEmailVerifyConcurrency || 5, 1),
    LEAD_EMAIL_VERIFY_CONCURRENCY_HARD_MAX,
  );
}
const MARKDOWN_PREVIEW_CHARS = 1200;

const COMMON_CONTACT_PATHS = ['/contact', '/contact-us'];
const COMMON_ABOUT_PATHS = ['/about', '/about-us'];

const DIRECTORY_PATH_RE =
  /\/(distributors?|directory|directories|listings?|companies|suppliers?|vendors?|catalog)(\/|$)/i;
const DIRECTORY_TEXT_RE =
  /\b(directory|distributors?\s*\(\d+\)|supplier\s+directory|company\s+directory|find\s+distributors?|top\s+\d+\s+.+?\bcompanies\b|list\s+of\s+(distributors?|suppliers?|companies))\b/i;

export type DiscoveryPreviewInput = {
  query: string;
  maxCandidates?: number;
};

export type DiscoveryPreviewCompany = {
  domain: string;
  website: string;
  search: {
    title: string;
    description: string;
    engine: string;
    query?: string;
    queries?: string[];
  };
  candidateKind: 'company_likely' | 'directory_likely';
  researchedPages: string[];
  websiteResearch: {
    title: string;
    markdownPreview: string;
  } | null;
  contacts: {
    emails: Array<{
      email: string;
      sourceUrl?: string;
      verification: Record<string, unknown> | null;
    }>;
    phones: Array<{ phone: string; sourceUrl?: string }>;
    linkedin: Array<{ url: string; sourceUrl?: string }>;
    facebook: Array<{ url: string; sourceUrl?: string }>;
    instagram: Array<{ url: string; sourceUrl?: string }>;
  };
  sources: Array<'searxng' | 'firecrawl' | 'keelead'>;
};

export type ResearchCandidateHit = SearxngSearchHit & {
  searchQuery?: string;
  searchQueries?: string[];
  searchRank?: number;
};

export type DiscoverCandidatesInput = {
  query: string;
  limit?: number;
};

export type DiscoverCandidatesResult = {
  query: string;
  hits: SearxngSearchHit[];
  errors: LeadProviderError[];
};

export type ResearchCandidatesInput = {
  hits: ResearchCandidateHit[];
  /** Hard safety cap; defaults to env research budget. */
  maxCompanies?: number;
  assertNotCancelled?: () => Promise<void>;
  onProgress?: (patch: { phase: 'RESEARCHING' | 'VERIFYING'; researched?: number }) => Promise<void>;
};

export type ResearchCandidatesResult = {
  companies: DiscoveryPreviewCompany[];
  researched: number;
  successful: number;
  pagesScraped: number;
  keeleadVerifyCalls: number;
  errors: LeadProviderError[];
};

export type DiscoveryPreviewResult = {
  query: string;
  stats: {
    searchResults: number;
    uniqueDomains: number;
    researched: number;
    successful: number;
    pagesScraped: number;
    keeleadVerifyCalls: number;
  };
  companies: DiscoveryPreviewCompany[];
  errors: LeadProviderError[];
  durationMs: number;
};

function homepageUrl(domain: string): string {
  return `https://${domain}/`;
}

export function isDirectoryLikely(hit: SearxngSearchHit): boolean {
  try {
    const path = new URL(hit.url).pathname;
    if (DIRECTORY_PATH_RE.test(path)) return true;
  } catch {
    // ignore
  }
  const blob = `${hit.title}\n${hit.description}`;
  return DIRECTORY_TEXT_RE.test(blob);
}

function dedupeByDomain(hits: SearxngSearchHit[]): SearxngSearchHit[] {
  const seen = new Set<string>();
  const out: SearxngSearchHit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.domain)) continue;
    seen.add(hit.domain);
    out.push(hit);
  }
  return out;
}

/** Prefer company-like sites; keep directories but deprioritize. */
export function rankCandidates(hits: SearxngSearchHit[]): SearxngSearchHit[] {
  return [...hits].sort((a, b) => {
    const aDir = isDirectoryLikely(a) ? 1 : 0;
    const bDir = isDirectoryLikely(b) ? 1 : 0;
    if (aDir !== bDir) return aDir - bDir;
    return 0;
  });
}

function sameDomain(link: string, domain: string): boolean {
  try {
    const host = new URL(link).hostname.toLowerCase().replace(/^www\./, '');
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

function pathLooksLike(link: string, kinds: 'contact' | 'about'): boolean {
  try {
    const path = new URL(link).pathname.toLowerCase().replace(/\/+$/, '') || '/';
    if (kinds === 'contact') {
      return /(^|\/)(contact|contact-us|contacts|get-in-touch)(\/|$)/i.test(path);
    }
    return /(^|\/)(about|about-us|company|who-we-are)(\/|$)/i.test(path);
  } catch {
    return false;
  }
}

function pickFromLinks(
  links: string[],
  domain: string,
  kind: 'contact' | 'about',
): string | undefined {
  return links.find((l) => sameDomain(l, domain) && pathLooksLike(l, kind));
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const key = u.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

/**
 * Build homepage + contact/about candidate URLs.
 * Prefer real Firecrawl map links; otherwise queue common paths (404s ignored later).
 * Caller scrapes until at most MAX_PAGES_PER_COMPANY successes.
 */
export async function selectResearchPages(domain: string): Promise<{
  homepage: string;
  contactCandidates: string[];
  aboutCandidates: string[];
  mapUsed: boolean;
  mapError?: string;
}> {
  const home = homepageUrl(domain);
  let mapUsed = false;
  let mapError: string | undefined;
  let mappedLinks: string[] = [];

  try {
    mappedLinks = await firecrawlProvider.mapWebsite(home);
    mapUsed = true;
  } catch (err) {
    mapError = err instanceof Error ? err.message : String(err);
  }

  const mappedContact = pickFromLinks(mappedLinks, domain, 'contact');
  const mappedAbout = pickFromLinks(mappedLinks, domain, 'about');

  const contactCandidates = dedupeUrls([
    ...(mappedContact ? [mappedContact] : []),
    ...COMMON_CONTACT_PATHS.map((path) => `https://${domain}${path}`),
  ]).filter((u) => u.replace(/\/$/, '').toLowerCase() !== home.replace(/\/$/, '').toLowerCase());

  const aboutCandidates = dedupeUrls([
    ...(mappedAbout ? [mappedAbout] : []),
    ...COMMON_ABOUT_PATHS.map((path) => `https://${domain}${path}`),
  ]).filter((u) => u.replace(/\/$/, '').toLowerCase() !== home.replace(/\/$/, '').toLowerCase());

  return { homepage: home, contactCandidates, aboutCandidates, mapUsed, mapError };
}

async function scrapeOneSoft(
  pageUrl: string,
  domain: string,
  errors: LeadProviderError[],
): Promise<{ url: string; title: string; markdown: string } | null> {
  try {
    const result = await firecrawlProvider.scrapeWebsite(pageUrl);
    return {
      url: result.url || pageUrl,
      title: result.title || '',
      markdown: result.markdown || '',
    };
  } catch (err) {
    errors.push({
      provider: 'firecrawl',
      code: 'FIRECRAWL_PAGE_SKIPPED',
      message: err instanceof Error ? err.message : String(err),
      domain,
      url: pageUrl,
    });
    return null;
  }
}

/**
 * Scrape homepage, then first successful contact, then first successful about.
 * Max MAX_PAGES_PER_COMPANY successful pages. Failures are soft-skipped.
 */
async function researchCompanyPages(
  domain: string,
  selected: Awaited<ReturnType<typeof selectResearchPages>>,
  errors: LeadProviderError[],
): Promise<{
  scraped: Array<{ url: string; title: string; markdown: string }>;
  pagesScraped: number;
}> {
  const scraped: Array<{ url: string; title: string; markdown: string }> = [];

  const home = await scrapeOneSoft(selected.homepage, domain, errors);
  if (home) scraped.push(home);

  if (scraped.length < MAX_PAGES_PER_COMPANY) {
    for (const url of selected.contactCandidates) {
      const page = await scrapeOneSoft(url, domain, errors);
      if (page) {
        scraped.push(page);
        break;
      }
    }
  }

  if (scraped.length < MAX_PAGES_PER_COMPANY) {
    for (const url of selected.aboutCandidates) {
      const page = await scrapeOneSoft(url, domain, errors);
      if (page) {
        scraped.push(page);
        break;
      }
    }
  }

  return { scraped, pagesScraped: scraped.length };
}

/**
 * Search only — SearXNG. No DB. A provider error is returned, not thrown,
 * so callers can continue with other queries.
 */
export async function discoverCandidates(
  input: DiscoverCandidatesInput,
): Promise<DiscoverCandidatesResult> {
  const query = input.query.trim();
  const limit = Math.min(Math.max(input.limit ?? SEARCH_CANDIDATE_CAP, 1), SEARCH_CANDIDATE_CAP);
  const errors: LeadProviderError[] = [];
  let hits: SearxngSearchHit[] = [];
  try {
    hits = await searxngProvider.searchWebCompanies({ query, limit });
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'SEARXNG_ERROR';
    errors.push({
      provider: 'searxng',
      code,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return { query, hits, errors };
}

function researchHardCap(requested?: number): number {
  const envCap = Math.max(env.leadAgentMaxResearchCompanies || MAX_RESEARCH_HARD, 1);
  const n = requested ?? envCap;
  return Math.min(Math.max(n, 1), envCap);
}

async function verifyEmailsBounded(
  emails: Array<{ value: string; sourceUrl?: string }>,
  domain: string,
  sources: Array<'searxng' | 'firecrawl' | 'keelead'>,
  errors: LeadProviderError[],
): Promise<{
  emails: DiscoveryPreviewCompany['contacts']['emails'];
  keeleadVerifyCalls: number;
}> {
  const toVerify = emails.slice(0, MAX_EMAILS_PER_COMPANY);
  const concurrency = resolveEmailVerifyConcurrency();
  const verified = await mapWithConcurrency(toVerify, concurrency, async (item) => {
    try {
      const verification = await keeleadProvider.verifyEmail(item.value);
      if (!sources.includes('keelead')) sources.push('keelead');
      return {
        email: verification.email,
        ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
        verification: {
          score: verification.score,
          status: verification.status,
          details: verification.details ?? null,
          suggestion: verification.suggestion ?? null,
          notes: verification.notes ?? null,
        },
      };
    } catch (err) {
      errors.push({
        provider: 'keelead',
        code: 'KEELEAD_VERIFY_FAILED',
        message: err instanceof Error ? err.message : String(err),
        domain,
      });
      return {
        email: item.value,
        ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
        verification: null,
      };
    }
  });
  return { emails: verified, keeleadVerifyCalls: toVerify.length };
}

async function researchOneCompany(
  hit: ResearchCandidateHit,
  errors: LeadProviderError[],
  assertNotCancelled?: () => Promise<void>,
  onProgress?: ResearchCandidatesInput['onProgress'],
): Promise<{
  company: DiscoveryPreviewCompany;
  successful: boolean;
  pagesScraped: number;
  keeleadVerifyCalls: number;
}> {
  await assertNotCancelled?.();
  const sources: Array<'searxng' | 'firecrawl' | 'keelead'> = ['searxng'];
  const directoryLikely = isDirectoryLikely(hit);
  const queries = hit.searchQueries?.length
    ? hit.searchQueries
    : hit.searchQuery
      ? [hit.searchQuery]
      : [];
  const company: DiscoveryPreviewCompany = {
    domain: hit.domain,
    website: homepageUrl(hit.domain),
    search: {
      title: hit.title,
      description: hit.description,
      engine: hit.engine,
      ...(hit.searchQuery ? { query: hit.searchQuery } : {}),
      ...(queries.length ? { queries } : {}),
    },
    candidateKind: directoryLikely ? 'directory_likely' : 'company_likely',
    researchedPages: [],
    websiteResearch: null,
    contacts: {
      emails: [],
      phones: [],
      linkedin: [],
      facebook: [],
      instagram: [],
    },
    sources,
  };

  const selected = await selectResearchPages(hit.domain);
  if (selected.mapError) {
    errors.push({
      provider: 'firecrawl',
      code: 'FIRECRAWL_MAP_SKIPPED',
      message: selected.mapError,
      domain: hit.domain,
      url: homepageUrl(hit.domain),
    });
  }

  const { scraped, pagesScraped } = await researchCompanyPages(hit.domain, selected, errors);
  company.researchedPages = scraped.map((s) => s.url);

  if (scraped.length === 0) {
    return { company, successful: false, pagesScraped, keeleadVerifyCalls: 0 };
  }

  sources.push('firecrawl');
  const homeOrFirst = scraped[0];
  const mergedMarkdown = scraped.map((s) => s.markdown).join('\n\n');
  company.websiteResearch = {
    title: homeOrFirst.title || '',
    markdownPreview: mergedMarkdown.slice(0, MARKDOWN_PREVIEW_CHARS),
  };

  const pageExtracts: ExtractedContacts[] = scraped.map((s) =>
    extractContactsFromText(`${s.markdown}\n${s.title}`, s.url),
  );
  const extracted = mergeExtractedContacts(pageExtracts);

  company.contacts.phones = extracted.phones.map((p) => ({
    phone: p.value,
    ...(p.sourceUrl ? { sourceUrl: p.sourceUrl } : {}),
  }));
  company.contacts.linkedin = extracted.linkedin.map((p) => ({
    url: p.value,
    ...(p.sourceUrl ? { sourceUrl: p.sourceUrl } : {}),
  }));
  company.contacts.facebook = extracted.facebook.map((p) => ({
    url: p.value,
    ...(p.sourceUrl ? { sourceUrl: p.sourceUrl } : {}),
  }));
  company.contacts.instagram = extracted.instagram.map((p) => ({
    url: p.value,
    ...(p.sourceUrl ? { sourceUrl: p.sourceUrl } : {}),
  }));

  await assertNotCancelled?.();
  await onProgress?.({ phase: 'VERIFYING' });
  const verified = await verifyEmailsBounded(extracted.emails, hit.domain, sources, errors);
  company.contacts.emails = verified.emails;
  return {
    company,
    successful: true,
    pagesScraped,
    keeleadVerifyCalls: verified.keeleadVerifyCalls,
  };
}

/**
 * Research only — Firecrawl + regex contacts + KeeLead. No DB.
 * One company failure does not stop the rest. Hard-capped by env.
 */
export async function researchCandidates(
  input: ResearchCandidatesInput,
): Promise<ResearchCandidatesResult> {
  const errors: LeadProviderError[] = [];
  const cap = researchHardCap(input.maxCompanies);
  const toResearch = input.hits.slice(0, cap);
  const concurrency = resolveResearchConcurrency();
  let cancelled = false;

  const results = await mapWithConcurrency(toResearch, concurrency, async (hit) => {
    try {
      if (cancelled) return null;
      return await researchOneCompany(hit, errors, input.assertNotCancelled, input.onProgress);
    } catch (err) {
      if (isLeadTaskCancelledError(err)) {
        cancelled = true;
        return null;
      }
      errors.push({
        provider: 'firecrawl',
        code: 'RESEARCH_COMPANY_FAILED',
        message: err instanceof Error ? err.message : String(err),
        domain: hit.domain,
      });
      return null;
    }
  });

  const companies: DiscoveryPreviewCompany[] = [];
  let successful = 0;
  let pagesScraped = 0;
  let keeleadVerifyCalls = 0;
  for (const row of results) {
    if (!row) continue;
    companies.push(row.company);
    if (row.successful) successful += 1;
    pagesScraped += row.pagesScraped;
    keeleadVerifyCalls += row.keeleadVerifyCalls;
  }

  const result = {
    companies,
    researched: companies.length,
    successful,
    pagesScraped,
    keeleadVerifyCalls,
    errors,
  };
  if (cancelled) {
    const err = new LeadTaskCancelledError();
    err.partial = result;
    throw err;
  }
  return result;
}

/**
 * Dry-run lead discovery — no Prisma writes.
 * Single-query preview: SearXNG → rank/dedupe → research.
 */
export async function runDiscoveryPreview(
  input: DiscoveryPreviewInput,
): Promise<DiscoveryPreviewResult> {
  const started = Date.now();
  const query = input.query.trim();
  const maxCandidates = Math.min(
    Math.max(input.maxCandidates ?? DEFAULT_MAX_RESEARCH, 1),
    MAX_RESEARCH_HARD,
  );

  const discovered = await discoverCandidates({ query, limit: SEARCH_CANDIDATE_CAP });
  const unique = rankCandidates(dedupeByDomain(discovered.hits));
  const toResearch = unique.slice(0, maxCandidates).map((hit) => ({
    ...hit,
    searchQuery: query,
    searchQueries: [query],
  }));
  const researched = await researchCandidates({
    hits: toResearch,
    maxCompanies: maxCandidates,
  });

  return {
    query,
    stats: {
      searchResults: discovered.hits.length,
      uniqueDomains: unique.length,
      researched: researched.researched,
      successful: researched.successful,
      pagesScraped: researched.pagesScraped,
      keeleadVerifyCalls: researched.keeleadVerifyCalls,
    },
    companies: researched.companies,
    errors: [...discovered.errors, ...researched.errors],
    durationMs: Date.now() - started,
  };
}

export const leadDiscoveryService = {
  runDiscoveryPreview,
  discoverCandidates,
  researchCandidates,
  dedupeByDomain,
  rankCandidates,
  isDirectoryLikely,
  selectResearchPages,
  SEARCH_CANDIDATE_CAP,
  MAX_RESEARCH_HARD,
  resolveResearchConcurrency,
  resolveEmailVerifyConcurrency,
  LEAD_RESEARCH_CONCURRENCY_HARD_MAX,
  LEAD_EMAIL_VERIFY_CONCURRENCY_HARD_MAX,
  MAX_EMAILS_PER_COMPANY,
  MAX_PAGES_PER_COMPANY,
};
