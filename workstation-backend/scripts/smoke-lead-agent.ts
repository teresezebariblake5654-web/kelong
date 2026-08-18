/**
 * Live Acquisition Agent smoke (in-process worker path).
 * Usage:
 *   npm run smoke:leads:agent
 *   LEAD_AGENT_MAX_TOTAL_QUERIES=2 npm run smoke:leads:agent -- --budget
 *
 * Requires SearXNG + Firecrawl. LLM is optional (planner falls back).
 */
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { env } from '../src/config/env';
import { initLlmRuntimeFromEnv } from '../src/providers/llm';
import { leadDiscoveryRunService } from '../src/services/leads/lead-discovery-run.service';

function argFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const budgetOnly = argFlag('budget');
  const narrow = argFlag('narrow');
  const query = narrow
    ? 'cardiovascular medical device distributors Saudi Arabia'
    : 'medical device distributors Saudi Arabia';

  if (budgetOnly) {
    env.leadAgentMaxTotalQueries = 2;
  }

  initLlmRuntimeFromEnv();
  console.log('[smoke-agent] query=', query);
  console.log('[smoke-agent] maxTotalQueries=', env.leadAgentMaxTotalQueries);
  console.log('[smoke-agent] maxResearch=', env.leadAgentMaxResearchCompanies);
  console.log('[smoke-agent] searxng=', env.searxngBaseUrl || '(empty)');
  console.log('[smoke-agent] firecrawl=', env.firecrawlBaseUrl || '(empty)');
  console.log('[smoke-agent] llmModel=', env.llmModel || '(default)');

  if (!env.searxngBaseUrl) throw new Error('SEARXNG_BASE_URL required');
  if (!env.firecrawlBaseUrl) throw new Error('FIRECRAWL_BASE_URL required');

  await connectDatabase();
  const suffix = Date.now();
  const org = await prisma.organization.create({
    data: { name: `Agent Smoke ${suffix}`, slug: `agent-smoke-${suffix}` },
  });

  try {
    const result = await leadDiscoveryRunService.runLeadDiscovery({
      organizationId: org.id,
      query,
      maxCandidates: 3,
    });

    const task = await prisma.leadSearchTask.findUniqueOrThrow({ where: { id: result.task.id } });
    const meta = (task.metadata ?? {}) as Record<string, unknown>;
    const agent = (meta.acquisitionAgent ?? {}) as Record<string, unknown>;
    const executed = Array.isArray(agent.executedQueries)
      ? (agent.executedQueries as Array<{ query?: string }>)
      : [];

    console.log('[smoke-agent] taskId', task.id);
    console.log('[smoke-agent] status', task.status);
    console.log('[smoke-agent] counts', {
      searchResults: task.searchResultsCount,
      uniqueDomains: task.uniqueDomainsCount,
      researched: task.researchedCount,
      successful: task.successfulCount,
      savedCompanies: result.stats.savedCompanies,
    });
    console.log('[smoke-agent] stopReason', agent.stopReason);
    console.log('[smoke-agent] requestedTarget', agent.requestedTarget);
    console.log('[smoke-agent] effectiveResearchLimit', agent.effectiveResearchLimit);
    console.log('[smoke-agent] executedQueries', executed.map((q) => q.query));
    console.log(
      '[smoke-agent] companies',
      result.companies.map((c) => c.normalizedDomain),
    );

    if (task.status !== 'COMPLETED') {
      throw new Error(`expected COMPLETED, got ${task.status}`);
    }
    if (!budgetOnly && executed.length < 2) {
      throw new Error(`expected multiple agent queries, got ${executed.length}`);
    }
    if (budgetOnly) {
      if (executed.length > 2) {
        throw new Error(`budget smoke executed ${executed.length} queries`);
      }
      if (String(agent.stopReason) !== 'MAX_QUERIES' && executed.length !== 2) {
        throw new Error(`budget smoke stopReason=${String(agent.stopReason)}`);
      }
    }
    if (narrow) {
      const blob = executed.map((q) => q.query ?? '').join(' ').toLowerCase();
      if (!/(cardio|cardiac|importer|ksa|saudi)/.test(blob)) {
        throw new Error(`narrow smoke queries did not expand specialty/location: ${blob}`);
      }
    }
    if (!budgetOnly && result.stats.savedCompanies < 1) {
      throw new Error('expected at least one persisted company');
    }
    console.log('[smoke-agent] PASS');
  } finally {
    await prisma.leadSourceRecord.deleteMany({ where: { organizationId: org.id } });
    await prisma.leadContact.deleteMany({ where: { organizationId: org.id } });
    await prisma.leadCompany.deleteMany({ where: { organizationId: org.id } });
    await prisma.leadSearchTask.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await disconnectDatabase();
  }
}

main().catch((err) => {
  console.error('[smoke-agent] FAILED', err);
  process.exit(1);
});
