/** Shared Lead Provider types (HTTP clients only — no fake leads). */

export type LeadProviderError = {
  provider: 'searxng' | 'firecrawl' | 'keelead';
  code: string;
  message: string;
  domain?: string;
  url?: string;
};

export type SearxngSearchHit = {
  title: string;
  url: string;
  domain: string;
  description: string;
  engine: string;
};

export type FirecrawlScrapeResult = {
  url: string;
  title: string;
  markdown: string;
  metadata: Record<string, unknown>;
};

export type KeeleadVerificationResult = {
  email: string;
  score: number;
  status: string;
  layers?: unknown[];
  details?: Record<string, unknown>;
  suggestion?: string;
  notes?: string[];
  raw?: unknown;
};
