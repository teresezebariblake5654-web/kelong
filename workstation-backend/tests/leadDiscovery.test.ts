import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  extractContactsFromText,
  mergeExtractedContacts,
} from '../src/services/leads/lead-normalizer.service';
import {
  normalizeDomainFromUrl,
  isBlockedLeadHost,
  searchWebCompanies,
} from '../src/providers/lead-engines/searxng.provider';
import { leadDiscoveryService } from '../src/services/leads/lead-discovery.service';
import { env } from '../src/config/env';
import * as searxngMod from '../src/providers/lead-engines/searxng.provider';
import * as firecrawlMod from '../src/providers/lead-engines/firecrawl.provider';
import * as keeleadMod from '../src/providers/lead-engines/keelead.provider';

describe('lead normalizer regex', () => {
  it('extracts emails with provenance', () => {
    const r = extractContactsFromText(
      'Contact us at sales@acme-med.com or info@acme-med.com',
      'https://acme-med.com/contact',
    );
    expect(r.emails.map((e) => e.value)).toEqual(['sales@acme-med.com', 'info@acme-med.com']);
    expect(r.emails[0].sourceUrl).toBe('https://acme-med.com/contact');
  });

  it('extracts phones conservatively', () => {
    const r = extractContactsFromText('Call +966 11 123 4567 or (415) 555-0199');
    expect(r.phones.length).toBeGreaterThan(0);
  });

  it('extracts social URLs', () => {
    const r = extractContactsFromText(`
      https://www.linkedin.com/company/acme
      https://facebook.com/acme
      https://instagram.com/acme
    `);
    expect(r.linkedin[0].value).toContain('linkedin.com');
    expect(r.facebook[0].value).toContain('facebook.com');
    expect(r.instagram[0].value).toContain('instagram.com');
  });

  it('merges and dedupes across pages keeping first provenance', () => {
    const a = extractContactsFromText('sales@acme.com', 'https://acme.com/contact');
    const b = extractContactsFromText('sales@acme.com phone +1 415-555-0100', 'https://acme.com/about');
    const m = mergeExtractedContacts([a, b]);
    expect(m.emails).toHaveLength(1);
    expect(m.emails[0].sourceUrl).toBe('https://acme.com/contact');
    expect(m.phones[0].sourceUrl).toBe('https://acme.com/about');
  });

  it('does not invent contacts from empty text', () => {
    const r = extractContactsFromText('');
    expect(r.emails).toEqual([]);
    expect(r.phones).toEqual([]);
  });
});

describe('searxng normalization', () => {
  it('normalizes domain and strips hash', () => {
    expect(normalizeDomainFromUrl('https://WWW.Example.com/path#frag')).toBe('example.com');
  });

  it('blocks youtube/github/npm/reddit/wikipedia', () => {
    expect(isBlockedLeadHost('www.youtube.com')).toBe(true);
    expect(isBlockedLeadHost('github.com')).toBe(true);
    expect(isBlockedLeadHost('registry.npmjs.org')).toBe(true);
  });

  it('maps SearXNG JSON without inventing companies', async () => {
    const prev = env.searxngBaseUrl;
    env.searxngBaseUrl = 'http://searx.test';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: 'Acme Med',
                url: 'https://acme-med.example/about#team',
                content: 'Distributor',
                engine: 'google',
              },
              {
                title: 'Noise',
                url: 'https://www.youtube.com/watch?v=1',
                content: 'video',
                engine: 'google',
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    try {
      const hits = await searchWebCompanies({ query: 'medical', limit: 10 });
      expect(hits).toHaveLength(1);
      expect(hits[0].domain).toBe('acme-med.example');
      expect(hits[0].url).not.toContain('#');
    } finally {
      env.searxngBaseUrl = prev;
      vi.unstubAllGlobals();
    }
  });
});

describe('lead discovery ranking / research', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deprioritizes directory-like candidates without excluding them', () => {
    const ranked = leadDiscoveryService.rankCandidates([
      {
        title: 'Saudi Distributors (50) Directory',
        url: 'https://guide.example/distributors/saudi',
        domain: 'guide.example',
        description: 'directory of distributors',
        engine: 'x',
      },
      {
        title: 'And Medical',
        url: 'https://and-medical.com/',
        domain: 'and-medical.com',
        description: 'medical devices',
        engine: 'x',
      },
    ]);
    expect(ranked[0].domain).toBe('and-medical.com');
    expect(leadDiscoveryService.isDirectoryLikely(ranked[1])).toBe(true);
  });

  it('continues when one page scrape fails and still extracts from others', async () => {
    vi.spyOn(searxngMod.searxngProvider, 'searchWebCompanies').mockResolvedValue([
      {
        title: 'One',
        url: 'https://one.example/path',
        domain: 'one.example',
        description: 'd1',
        engine: 'google',
      },
    ]);
    vi.spyOn(firecrawlMod.firecrawlProvider, 'mapWebsite').mockResolvedValue([
      'https://one.example/',
      'https://one.example/contact',
      'https://one.example/about',
    ]);
    vi.spyOn(firecrawlMod.firecrawlProvider, 'scrapeWebsite').mockImplementation(async (url: string) => {
      if (url.includes('/about')) throw new Error('404');
      if (url.includes('/contact')) {
        return {
          url,
          title: 'Contact',
          markdown: 'Email sales@one.example',
          metadata: {},
        };
      }
      return {
        url,
        title: 'Home',
        markdown: 'Welcome https://linkedin.com/company/one',
        metadata: {},
      };
    });
    vi.spyOn(keeleadMod.keeleadProvider, 'verifyEmail').mockResolvedValue({
      email: 'sales@one.example',
      score: 80,
      status: 'valid',
      details: { syntax: true },
    });

    const result = await leadDiscoveryService.runDiscoveryPreview({
      query: 'medical',
      maxCandidates: 1,
    });

    expect(result.stats.successful).toBe(1);
    expect(result.stats.pagesScraped).toBe(2);
    expect(result.stats.keeleadVerifyCalls).toBe(1);
    expect(result.companies[0].contacts.emails[0]?.email).toBe('sales@one.example');
    expect(result.companies[0].contacts.emails[0]?.sourceUrl).toContain('/contact');
    expect(result.companies[0].website).toBe('https://one.example/');
    expect(result.errors.some((e) => e.code === 'FIRECRAWL_PAGE_SKIPPED')).toBe(true);
  });

  it('tries next common contact path when first fails and map is empty', async () => {
    vi.spyOn(searxngMod.searxngProvider, 'searchWebCompanies').mockResolvedValue([
      {
        title: 'Two',
        url: 'https://two.example/',
        domain: 'two.example',
        description: 'co',
        engine: 'google',
      },
    ]);
    vi.spyOn(firecrawlMod.firecrawlProvider, 'mapWebsite').mockResolvedValue([]);
    vi.spyOn(firecrawlMod.firecrawlProvider, 'scrapeWebsite').mockImplementation(async (url: string) => {
      if (url.endsWith('/contact')) throw new Error('404');
      if (url.endsWith('/contact-us')) {
        return { url, title: 'Contact Us', markdown: 'hello@two.example', metadata: {} };
      }
      if (url.includes('/about')) throw new Error('404');
      return { url, title: 'Home', markdown: 'hi', metadata: {} };
    });
    vi.spyOn(keeleadMod.keeleadProvider, 'verifyEmail').mockResolvedValue({
      email: 'hello@two.example',
      score: 70,
      status: 'unknown',
      details: {},
    });

    const result = await leadDiscoveryService.runDiscoveryPreview({
      query: 'q',
      maxCandidates: 1,
    });

    expect(result.companies[0].contacts.emails[0]?.email).toBe('hello@two.example');
    expect(result.companies[0].contacts.emails[0]?.sourceUrl).toContain('/contact-us');
    expect(result.stats.pagesScraped).toBe(2);
  });

  it('respects maxCandidates hard cap of 5 and max 3 successful pages/domain', async () => {
    const hits = Array.from({ length: 10 }, (_, i) => ({
      title: `C${i}`,
      url: `https://c${i}.example/`,
      domain: `c${i}.example`,
      description: '',
      engine: 'x',
    }));
    vi.spyOn(searxngMod.searxngProvider, 'searchWebCompanies').mockResolvedValue(hits);
    vi.spyOn(firecrawlMod.firecrawlProvider, 'mapWebsite').mockResolvedValue([]);
    const scrape = vi.spyOn(firecrawlMod.firecrawlProvider, 'scrapeWebsite').mockResolvedValue({
      url: 'https://x',
      title: 't',
      markdown: '',
      metadata: {},
    });

    const result = await leadDiscoveryService.runDiscoveryPreview({
      query: 'q',
      maxCandidates: 5,
    });
    expect(result.stats.researched).toBe(5);
    // home success + first contact success + first about success = 3 per domain
    expect(scrape.mock.calls.length).toBe(5 * 3);
    expect(result.stats.pagesScraped).toBe(5 * 3);
  });
});
