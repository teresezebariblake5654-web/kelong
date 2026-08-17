import { AppError } from '../../utils/errors';
import { searxngProvider } from '../../providers/lead-engines/searxng.provider';
import { firecrawlProvider } from '../../providers/lead-engines/firecrawl.provider';
import { keeleadProvider } from '../../providers/lead-engines/keelead.provider';
import type { LeadProviderError, SearxngSearchHit } from '../../providers/lead-engines/lead-provider.types';
import {
  extractContactsFromText,
  mergeExtractedContacts,
  type ExtractedContacts,
} from './lead-normalizer.service';

const SEARCH_CANDIDATE_CAP = 20;
const DEFAULT_MAX_RESEARCH = 5;
const MAX_RESEARCH_HARD = 5;
const MAX_EMAILS_PER_COMPANY = 3;
const MAX_PAGES_PER_COMPANY = 3;
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
 * Dry-run lead discovery — no Prisma writes.
 * SearXNG → rank/dedupe → map+scrape homepage/contact/about → regex → KeeLead verify
 */
export async function runDiscoveryPreview(
  input: DiscoveryPreviewInput,
): Promise<DiscoveryPreviewResult> {
  const started = Date.now();
  const errors: LeadProviderError[] = [];
  const query = input.query.trim();
  const maxCandidates = Math.min(
    Math.max(input.maxCandidates ?? DEFAULT_MAX_RESEARCH, 1),
    MAX_RESEARCH_HARD,
  );

  let searchHits: SearxngSearchHit[] = [];
  try {
    searchHits = await searxngProvider.searchWebCompanies({
      query,
      limit: SEARCH_CANDIDATE_CAP,
    });
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'SEARXNG_ERROR';
    errors.push({
      provider: 'searxng',
      code,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const unique = rankCandidates(dedupeByDomain(searchHits));
  const toResearch = unique.slice(0, maxCandidates);
  const companies: DiscoveryPreviewCompany[] = [];
  let successful = 0;
  let pagesScraped = 0;
  let keeleadVerifyCalls = 0;

  for (const hit of toResearch) {
    const sources: Array<'searxng' | 'firecrawl' | 'keelead'> = ['searxng'];
    const directoryLikely = isDirectoryLikely(hit);
    const company: DiscoveryPreviewCompany = {
      domain: hit.domain,
      website: homepageUrl(hit.domain),
      search: {
        title: hit.title,
        description: hit.description,
        engine: hit.engine,
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

    const { scraped, pagesScraped: n } = await researchCompanyPages(
      hit.domain,
      selected,
      errors,
    );
    pagesScraped += n;
    company.researchedPages = scraped.map((s) => s.url);

    if (scraped.length === 0) {
      companies.push(company);
      continue;
    }

    sources.push('firecrawl');
    successful += 1;

    const homeOrFirst = scraped[0];
    const mergedMarkdown = scraped.map((s) => s.markdown).join('\n\n');
    company.websiteResearch = {
      title: homeOrFirst.title || '',
      markdownPreview: mergedMarkdown.slice(0, MARKDOWN_PREVIEW_CHARS),
    };

    const pageExtracts: ExtractedContacts[] = scraped.map((s) =>
      extractContactsFromText(
        `${s.markdown}\n${s.title}`,
        s.url,
      ),
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

    const emailsToVerify = extracted.emails.slice(0, MAX_EMAILS_PER_COMPANY);
    for (const item of emailsToVerify) {
      keeleadVerifyCalls += 1;
      try {
        const verification = await keeleadProvider.verifyEmail(item.value);
        if (!sources.includes('keelead')) sources.push('keelead');
        company.contacts.emails.push({
          email: verification.email,
          ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
          verification: {
            score: verification.score,
            status: verification.status,
            details: verification.details ?? null,
            suggestion: verification.suggestion ?? null,
            notes: verification.notes ?? null,
          },
        });
      } catch (err) {
        errors.push({
          provider: 'keelead',
          code: 'KEELEAD_VERIFY_FAILED',
          message: err instanceof Error ? err.message : String(err),
          domain: hit.domain,
        });
        company.contacts.emails.push({
          email: item.value,
          ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
          verification: null,
        });
      }
    }

    companies.push(company);
  }

  return {
    query,
    stats: {
      searchResults: searchHits.length,
      uniqueDomains: unique.length,
      researched: toResearch.length,
      successful,
      pagesScraped,
      keeleadVerifyCalls,
    },
    companies,
    errors,
    durationMs: Date.now() - started,
  };
}

export const leadDiscoveryService = {
  runDiscoveryPreview,
  dedupeByDomain,
  rankCandidates,
  isDirectoryLikely,
  selectResearchPages,
  SEARCH_CANDIDATE_CAP,
  MAX_RESEARCH_HARD,
  MAX_EMAILS_PER_COMPANY,
  MAX_PAGES_PER_COMPANY,
};
