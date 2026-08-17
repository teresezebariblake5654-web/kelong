/**
 * Live discovery + persistence smoke (writes Lead* tables).
 * Usage: npm run smoke:leads:persist
 *
 * Runs the same query twice against one org and prints DB deltas.
 */

import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { env } from '../src/config/env';
import { leadDiscoveryRunService } from '../src/services/leads/lead-discovery-run.service';

async function countLeads(organizationId: string) {
  const [tasks, companies, contacts, sources] = await Promise.all([
    prisma.leadSearchTask.count({ where: { organizationId } }),
    prisma.leadCompany.count({ where: { organizationId } }),
    prisma.leadContact.count({ where: { organizationId } }),
    prisma.leadSourceRecord.count({ where: { organizationId } }),
  ]);
  return { tasks, companies, contacts, sources };
}

async function main() {
  console.log('[smoke-persist] searxng=', env.searxngBaseUrl || '(empty)');
  console.log('[smoke-persist] firecrawl=', env.firecrawlBaseUrl || '(empty)');
  console.log('[smoke-persist] keelead=', env.keeleadBaseUrl || '(empty)');
  console.log(
    '[smoke-persist] keeleadKey=',
    env.keeleadProviderKey ? `SET(len=${env.keeleadProviderKey.length})` : 'EMPTY',
  );

  if (!env.searxngBaseUrl) throw new Error('SEARXNG_BASE_URL required');
  if (!env.firecrawlBaseUrl) throw new Error('FIRECRAWL_BASE_URL required');

  await connectDatabase();

  const suffix = Date.now();
  const org = await prisma.organization.create({
    data: {
      name: `Lead Smoke Org ${suffix}`,
      slug: `lead-smoke-${suffix}`,
    },
  });

  const query = 'medical device distributors Saudi Arabia';
  const maxCandidates = 3;

  try {
    const before = await countLeads(org.id);
    console.log('[smoke-persist] before', before);

    console.log('[smoke-persist] === RUN 1 ===');
    const run1 = await leadDiscoveryRunService.runLeadDiscovery({
      organizationId: org.id,
      query,
      maxCandidates,
    });
    const after1 = await countLeads(org.id);
    console.log('[smoke-persist] run1 task', run1.task);
    console.log('[smoke-persist] run1 stats', run1.stats);
    console.log(
      '[smoke-persist] run1 companies',
      run1.companies.map((c) => ({
        domain: c.domain,
        contacts: c.contacts.length,
      })),
    );
    console.log('[smoke-persist] run1 errors', run1.errors.slice(0, 15));
    console.log('[smoke-persist] after1', after1);

    console.log('[smoke-persist] === RUN 2 (same query) ===');
    const run2 = await leadDiscoveryRunService.runLeadDiscovery({
      organizationId: org.id,
      query,
      maxCandidates,
    });
    const after2 = await countLeads(org.id);
    console.log('[smoke-persist] run2 task', run2.task);
    console.log('[smoke-persist] run2 stats', run2.stats);
    console.log(
      '[smoke-persist] run2 companies',
      run2.companies.map((c) => ({
        domain: c.domain,
        contacts: c.contacts.length,
      })),
    );
    console.log('[smoke-persist] run2 errors', run2.errors.slice(0, 15));
    console.log('[smoke-persist] after2', after2);

    console.log('[smoke-persist] === DELTAS ===');
    console.log('[smoke-persist] companies growth run1→run2', after2.companies - after1.companies);
    console.log('[smoke-persist] contacts growth run1→run2', after2.contacts - after1.contacts);
    console.log('[smoke-persist] tasks growth run1→run2', after2.tasks - after1.tasks);
    console.log('[smoke-persist] sources growth run1→run2', after2.sources - after1.sources);
    console.log('[smoke-persist] orgId', org.id);
  } finally {
    await disconnectDatabase();
  }
}

main().catch(async (err) => {
  console.error('[smoke-persist] FAILED', err);
  try {
    await disconnectDatabase();
  } catch {
    // ignore
  }
  process.exit(1);
});
