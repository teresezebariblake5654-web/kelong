/**
 * Acquisition Agent orchestrator.
 * PLAN / SEARCH / EVALUATE / RESEARCH — persistence stays in lead-persistence.
 */
import { env } from '../../../config/env';
import type { LeadProviderError, SearxngSearchHit } from '../../../providers/lead-engines/lead-provider.types';
import { logger } from '../../../utils/logger';
import {
  discoverCandidates,
  isDirectoryLikely,
  researchCandidates,
  SEARCH_CANDIDATE_CAP,
  type DiscoveryPreviewResult,
  type ResearchCandidateHit,
} from '../lead-discovery.service';
import { normalizeLeadDomain } from '../lead-persistence.service';
import {
  evaluateAcquisitionProgress,
  type EvaluateAcquisitionProgressResult,
} from './acquisition-agent-evaluator.service';
import { planAcquisitionQueries } from './acquisition-agent-planner.service';
import { LeadTaskCancelledError, isLeadTaskCancelledError } from '../lead-task-cancelled.error';
import type { LeadTaskProgress } from '../lead-task-progress.types';
import { rankAcquisitionCandidates } from './acquisition-agent-ranking';
import {
  ACQUISITION_AGENT_VERSION,
  type AcquisitionAgentBudget,
  type AcquisitionAgentLlmCall,
  type AcquisitionAgentSummary,
  type AcquisitionPlan,
  type AcquisitionStopReason,
  type AgentCandidate,
  type ExecutedQuerySummary,
} from './acquisition-agent.types';

export type AcquisitionAgentRunInput = {
  taskId: string;
  organizationId: string;
  prompt: string;
  targetCount: number;
  signal?: AbortSignal;
};

export type AcquisitionAgentRunResult = {
  discovery: DiscoveryPreviewResult;
  agentSummary: AcquisitionAgentSummary;
};

export type AcquisitionAgentRunDeps = {
  plan?: typeof planAcquisitionQueries;
  evaluate?: typeof evaluateAcquisitionProgress;
  discover?: typeof discoverCandidates;
  research?: typeof researchCandidates;
  budget?: AcquisitionAgentBudget;
  llmCall?: AcquisitionAgentLlmCall;
  assertNotCancelled?: () => Promise<void>;
  onProgress?: (patch: Partial<LeadTaskProgress>) => Promise<void>;
};

export function getAcquisitionAgentBudget(): AcquisitionAgentBudget {
  return {
    maxSearchRounds: Math.max(1, env.leadAgentMaxSearchRounds),
    maxQueriesPerRound: Math.max(1, env.leadAgentMaxQueriesPerRound),
    maxTotalQueries: Math.max(1, env.leadAgentMaxTotalQueries),
    maxResearchCompanies: Math.max(1, env.leadAgentMaxResearchCompanies),
    llmTimeoutMs: Math.max(1, env.leadAgentLlmTimeoutMs),
  };
}

export function normalizeQueryKey(query: string): string {
  return query.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function mergeHitsIntoPool(
  pool: Map<string, AgentCandidate>,
  query: string,
  hits: SearxngSearchHit[],
): number {
  let newDomains = 0;
  hits.forEach((hit, index) => {
    const normalizedDomain = normalizeLeadDomain(hit.domain);
    if (!normalizedDomain) return;
    const directoryLikely = isDirectoryLikely(hit);
    const kind = directoryLikely ? 'directory_likely' : 'company_likely';
    const provenance = {
      query,
      url: hit.url,
      title: hit.title,
      description: hit.description,
      engine: hit.engine,
      rank: index + 1,
    };
    const existing = pool.get(normalizedDomain);
    if (!existing) {
      pool.set(normalizedDomain, {
        domain: hit.domain,
        normalizedDomain,
        website: `https://${normalizedDomain}/`,
        title: hit.title,
        snippet: hit.description,
        candidateKind: kind,
        provenances: [provenance],
        researched: false,
      });
      newDomains += 1;
      return;
    }
    const already = existing.provenances.some(
      (p) => p.query === query && p.url === hit.url,
    );
    if (!already) existing.provenances.push(provenance);
    if (existing.candidateKind === 'directory_likely' && kind === 'company_likely') {
      existing.candidateKind = 'company_likely';
      existing.title = hit.title || existing.title;
      existing.snippet = hit.description || existing.snippet;
    }
  });
  return newDomains;
}

export function toResearchHits(candidates: AgentCandidate[]): ResearchCandidateHit[] {
  return candidates.map((c) => {
    const best = c.provenances[0];
    const queries = [...new Set(c.provenances.map((p) => p.query).filter(Boolean))];
    return {
      title: c.title,
      url: best?.url || c.website,
      domain: c.normalizedDomain,
      description: c.snippet,
      engine: best?.engine || 'searxng',
      searchQuery: best?.query || queries[0],
      searchQueries: queries,
      searchRank: best?.rank,
    };
  });
}

function takeNextQueries(
  pending: string[],
  executedKeys: Set<string>,
  limit: number,
): string[] {
  const out: string[] = [];
  const batchKeys = new Set<string>();
  while (pending.length > 0 && out.length < limit) {
    const query = pending.shift()!;
    const key = normalizeQueryKey(query);
    if (!key || executedKeys.has(key) || batchKeys.has(key)) continue;
    batchKeys.add(key);
    out.push(query);
  }
  return out;
}

function logAgent(
  taskId: string,
  fields: Record<string, unknown>,
): void {
  logger.info('[LeadAgent]', { taskId, ...fields });
}

export async function runAcquisitionAgent(
  input: AcquisitionAgentRunInput,
  deps: AcquisitionAgentRunDeps = {},
): Promise<AcquisitionAgentRunResult> {
  const started = Date.now();
  const prompt = input.prompt.trim();
  const budget = deps.budget ?? getAcquisitionAgentBudget();
  const requestedTarget = Math.max(1, input.targetCount);
  const effectiveResearchLimit = Math.min(requestedTarget, budget.maxResearchCompanies);
  const planFn = deps.plan ?? planAcquisitionQueries;
  const evaluateFn = deps.evaluate ?? evaluateAcquisitionProgress;
  const discoverFn = deps.discover ?? discoverCandidates;
  const researchFn = deps.research ?? researchCandidates;

  const checkpoint = async (phase?: LeadTaskProgress['phase'], extra?: Partial<LeadTaskProgress>) => {
    if (input.signal?.aborted) throw new LeadTaskCancelledError();
    await deps.assertNotCancelled?.();
    if (phase || extra) {
      await deps.onProgress?.({
        ...(phase ? { phase } : {}),
        ...extra,
      });
    }
  };

  logAgent(input.taskId, {
    phase: 'PLAN',
    requestedTarget,
    effectiveResearchLimit,
  });

  await checkpoint('PLANNING', { maxQueries: budget.maxTotalQueries });

  const planned = await planFn({
    prompt,
    targetCount: requestedTarget,
    llmCall: deps.llmCall,
  });
  const plan: AcquisitionPlan = planned.plan;

  logAgent(input.taskId, {
    phase: 'PLAN',
    queryCount: plan.queries.length,
    source: planned.source,
  });

  const pool = new Map<string, AgentCandidate>();
  const executedQueries: ExecutedQuerySummary[] = [];
  const executedKeys = new Set<string>();
  const pending = plan.queries.map((q) => q.query);
  const errors: LeadProviderError[] = [];
  let searchResultsCount = 0;
  let round = 0;
  let emptyRounds = 0;
  let llmFailStreak = 0;
  let stopReason: AcquisitionStopReason = 'NO_MORE_QUERIES';

  const remainingQuerySlots = () => Math.max(0, budget.maxTotalQueries - executedQueries.length);

  const maxLoop = budget.maxSearchRounds + 2;
  searchLoop: for (let loop = 0; loop < maxLoop; loop += 1) {
    await checkpoint();
    if (input.signal?.aborted) {
      throw new LeadTaskCancelledError();
    }
    if (round >= budget.maxSearchRounds) {
      stopReason = 'MAX_ROUNDS';
      break;
    }
    if (executedQueries.length >= budget.maxTotalQueries) {
      stopReason = 'MAX_QUERIES';
      break;
    }
    if (llmFailStreak >= 2) {
      stopReason = 'LLM_FAILURES';
      break;
    }

    let batch = takeNextQueries(
      pending,
      executedKeys,
      Math.min(budget.maxQueriesPerRound, remainingQuerySlots()),
    );

    if (batch.length === 0) {
      if (pool.size >= requestedTarget) {
        stopReason = 'TARGET_REACHED';
        break;
      }
      await checkpoint('EVALUATING', {
        searchRound: round,
        executedQueries: executedQueries.length,
        uniqueCandidates: pool.size,
        maxQueries: budget.maxTotalQueries,
      });
      const evalResult: EvaluateAcquisitionProgressResult = await evaluateFn({
        requestedTarget,
        uniqueCandidateCount: pool.size,
        researchedCount: 0,
        queryHistory: executedQueries.map((q) => q.query),
        topDomains: [...pool.keys()].slice(0, 15),
        domainSignals: {
          companyLikely: [...pool.values()].filter((c) => c.candidateKind === 'company_likely').length,
          directoryLikely: [...pool.values()].filter((c) => c.candidateKind === 'directory_likely').length,
        },
        llmCall: deps.llmCall,
      });
      if (evalResult.source === 'fallback' && pool.size < requestedTarget) {
        llmFailStreak += 1;
      } else {
        llmFailStreak = 0;
      }
      if (!evalResult.decision.shouldContinueSearching) {
        stopReason = evalResult.decision.enoughCandidates ? 'TARGET_REACHED' : 'NO_MORE_QUERIES';
        break;
      }
      pending.push(...evalResult.decision.supplementalQueries);
      batch = takeNextQueries(
        pending,
        executedKeys,
        Math.min(budget.maxQueriesPerRound, remainingQuerySlots()),
      );
      if (batch.length === 0) {
        stopReason = pool.size >= requestedTarget ? 'TARGET_REACHED' : 'NO_MORE_QUERIES';
        break;
      }
    }

    round += 1;
    let newInRound = 0;
    for (const query of batch) {
      await checkpoint('SEARCHING', {
        searchRound: round,
        executedQueries: executedQueries.length,
        uniqueCandidates: pool.size,
        maxQueries: budget.maxTotalQueries,
      });
      if (input.signal?.aborted) {
        throw new LeadTaskCancelledError();
      }
      if (executedQueries.length >= budget.maxTotalQueries) {
        stopReason = 'MAX_QUERIES';
        break searchLoop;
      }

      logAgent(input.taskId, {
        phase: 'SEARCH',
        round,
        query,
        totalCandidates: pool.size,
      });

      const discovered = await discoverFn({ query, limit: SEARCH_CANDIDATE_CAP });
      errors.push(...discovered.errors);
      searchResultsCount += discovered.hits.length;
      const newDomains = mergeHitsIntoPool(pool, query, discovered.hits);
      newInRound += newDomains;
      executedKeys.add(normalizeQueryKey(query));
      executedQueries.push({
        query,
        newDomains,
        hitCount: discovered.hits.length,
        ...(discovered.errors[0] ? { error: discovered.errors[0].message } : {}),
      });

      logAgent(input.taskId, {
        phase: 'SEARCH',
        round,
        query,
        newDomains,
        totalCandidates: pool.size,
      });
    }

    if (newInRound === 0) emptyRounds += 1;
    else emptyRounds = 0;
    if (emptyRounds >= 2) {
      stopReason = 'NO_NEW_DOMAINS';
      break;
    }
  }

  const ranked = rankAcquisitionCandidates([...pool.values()], plan.interpretation);
  const selected = ranked.slice(0, effectiveResearchLimit);
  const already = new Set<string>();
  const uniqueSelected = selected.filter((c) => {
    if (already.has(c.normalizedDomain)) return false;
    already.add(c.normalizedDomain);
    return true;
  });

  logAgent(input.taskId, {
    phase: 'RESEARCH',
    researchCount: uniqueSelected.length,
    totalCandidates: pool.size,
    effectiveResearchLimit,
  });

  await checkpoint('RESEARCHING', {
    uniqueCandidates: pool.size,
    executedQueries: executedQueries.length,
    searchRound: round,
    maxQueries: budget.maxTotalQueries,
  });

  let researched = {
    companies: [] as Awaited<ReturnType<typeof researchFn>>['companies'],
    researched: 0,
    successful: 0,
    pagesScraped: 0,
    keeleadVerifyCalls: 0,
    errors: [] as LeadProviderError[],
  };
  try {
    researched = await researchFn({
      hits: toResearchHits(uniqueSelected),
      maxCompanies: effectiveResearchLimit,
      assertNotCancelled: deps.assertNotCancelled,
      onProgress: async (patch) => {
        await deps.onProgress?.({
          phase: patch.phase,
          uniqueCandidates: pool.size,
          executedQueries: executedQueries.length,
          researched: patch.researched,
        });
      },
    });
  } catch (err) {
    if (isLeadTaskCancelledError(err) && err.partial && typeof err.partial === 'object') {
      researched = err.partial as typeof researched;
    } else if (!isLeadTaskCancelledError(err)) {
      throw err;
    }
    stopReason = 'CANCELLED';
  }
  errors.push(...researched.errors);
  for (const company of researched.companies) {
    const row = pool.get(normalizeLeadDomain(company.domain));
    if (row) row.researched = true;
  }

  const agentSummary: AcquisitionAgentSummary = {
    version: ACQUISITION_AGENT_VERSION,
    requestedTarget,
    effectiveResearchLimit,
    plan: {
      queryCount: plan.queries.length,
      source: planned.source,
    },
    executedQueries,
    searchRounds: round,
    uniqueCandidates: pool.size,
    stopReason,
  };

  logAgent(input.taskId, {
    phase: 'COMPLETE',
    stopReason,
    round,
    totalCandidates: pool.size,
    researchCount: researched.researched,
  });

  const result: AcquisitionAgentRunResult = {
    discovery: {
      query: prompt,
      stats: {
        searchResults: searchResultsCount,
        uniqueDomains: pool.size,
        researched: researched.researched,
        successful: researched.successful,
        pagesScraped: researched.pagesScraped,
        keeleadVerifyCalls: researched.keeleadVerifyCalls,
      },
      companies: researched.companies,
      errors,
      durationMs: Date.now() - started,
    },
    agentSummary,
  };

  if (stopReason === 'CANCELLED') {
    throw new LeadTaskCancelledError('Lead search task cancelled', result);
  }

  return result;
}

export const acquisitionAgentOrchestrator = {
  run: runAcquisitionAgent,
  mergeHitsIntoPool,
  toResearchHits,
  getAcquisitionAgentBudget,
  normalizeQueryKey,
};
