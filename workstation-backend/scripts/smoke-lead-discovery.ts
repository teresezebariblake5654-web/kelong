/**
 * Live dry-run smoke (no DB writes for leads).
 * Usage: npm run smoke:leads
 */

import { env } from '../src/config/env';
import { leadDiscoveryService } from '../src/services/leads/lead-discovery.service';

async function main() {
  console.log('[smoke-leads] searxng=', env.searxngBaseUrl || '(empty)');
  console.log('[smoke-leads] firecrawl=', env.firecrawlBaseUrl || '(empty)');
  console.log('[smoke-leads] keelead=', env.keeleadBaseUrl || '(empty)');
  console.log(
    '[smoke-leads] keeleadKey=',
    env.keeleadProviderKey ? `SET(len=${env.keeleadProviderKey.length})` : 'EMPTY',
  );

  if (!env.searxngBaseUrl) throw new Error('SEARXNG_BASE_URL required');
  if (!env.firecrawlBaseUrl) throw new Error('FIRECRAWL_BASE_URL required for this smoke');

  const started = Date.now();
  const result = await leadDiscoveryService.runDiscoveryPreview({
    query: 'medical device distributors Saudi Arabia',
    maxCandidates: 5,
  });

  const emailCount = result.companies.reduce((n, c) => n + c.contacts.emails.length, 0);
  const phoneCount = result.companies.reduce((n, c) => n + c.contacts.phones.length, 0);
  const socialCount = result.companies.reduce(
    (n, c) =>
      n + c.contacts.linkedin.length + c.contacts.facebook.length + c.contacts.instagram.length,
    0,
  );

  console.log('[smoke-leads] wallMs', Date.now() - started);
  console.log('[smoke-leads] durationMs', result.durationMs);
  console.log('[smoke-leads] stats', result.stats);
  console.log('[smoke-leads] emails', emailCount, 'phones', phoneCount, 'social', socialCount);
  console.log(
    '[smoke-leads] domains',
    result.companies.map((c) => ({
      domain: c.domain,
      kind: c.candidateKind,
      pages: c.researchedPages,
      emails: c.contacts.emails.length,
    })),
  );
  console.log('[smoke-leads] errors', JSON.stringify(result.errors.slice(0, 20), null, 2));
  console.log('[smoke-leads] sample', JSON.stringify(result.companies[0] ?? null, null, 2));
}

main().catch((err) => {
  console.error('[smoke-leads] FAILED', err);
  process.exit(1);
});
