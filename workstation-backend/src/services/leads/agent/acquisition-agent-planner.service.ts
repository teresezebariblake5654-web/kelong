/**
 * Planner: prompt → structured query strategy.
 * Does not search the web or invent companies.
 */
import { env } from '../../../config/env';
import {
  extractJsonObject,
  getActiveLlmModel,
  getOpenAICompatibleChatClient,
} from '../../../providers/llm';
import { logger } from '../../../utils/logger';
import {
  ACQUISITION_AGENT_VERSION,
  PLAN_QUERY_MAX,
  PLAN_QUERY_MIN,
  PLANNER_LLM_ATTEMPTS,
  acquisitionPlanSchema,
  type AcquisitionAgentLlmCall,
  type AcquisitionPlan,
  type PlannedQuery,
  type PlanInterpretation,
} from './acquisition-agent.types';

export const PLANNER_SYSTEM_PROMPT = `You are a B2B lead-acquisition search planner.

Your job is ONLY to interpret the user's acquisition goal and produce diverse web search queries.
You do NOT search the web. You do NOT invent company names. You do NOT claim any search succeeded.
You do NOT decide budgets, organizationId, or taskId.

Return ONLY a JSON object:
{
  "interpretation": {
    "targetMarket": string (optional),
    "industries": string[],
    "businessTypes": string[],
    "productKeywords": string[],
    "locationKeywords": string[],
    "exclusions": string[]
  },
  "queries": [
    { "query": string, "rationale": string, "priority": number }
  ]
}

Query rules:
- Produce between ${PLAN_QUERY_MIN} and ${PLAN_QUERY_MAX} queries (inclusive).
- Queries MUST be meaningfully different — not near-paraphrases of the same phrase.
- Cover product/specialty, business type (distributor / importer / supplier / dealer), and location variants.
- Example: for "沙特心外科医疗器械经销商" do NOT only emit
  "medical distributor Saudi Arabia" / "medical distributors Saudi Arabia" / "Saudi medical distributor".
  Instead cover distinct angles such as:
  cardiovascular device distributor Saudi Arabia,
  cardiac surgery equipment supplier KSA,
  medical device importer cardiovascular Saudi Arabia,
  hospital equipment distributor cardiac Saudi Arabia.
- Prefer English search queries that work on the open web.
- Short rationale only. No chain-of-thought.`;

function normalizeQueryKey(query: string): string {
  return query.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function dedupePlannedQueries(queries: PlannedQuery[]): PlannedQuery[] {
  const seen = new Set<string>();
  const out: PlannedQuery[] = [];
  for (const item of queries) {
    const key = normalizeQueryKey(item.query);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      query: item.query.trim(),
      rationale: item.rationale.trim(),
      priority: item.priority,
    });
  }
  return out.sort((a, b) => a.priority - b.priority || a.query.localeCompare(b.query));
}

function uniqueStrings(items: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.trim();
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

function inferInterpretation(prompt: string): PlanInterpretation {
  const lower = prompt.toLowerCase();
  const industries: string[] = [];
  const productKeywords: string[] = [];
  const locationKeywords: string[] = [];
  const businessTypes: string[] = [];

  if (/cardio|cardiac|heart|心血管|心外/.test(lower)) {
    industries.push('medical devices');
    productKeywords.push('cardiovascular', 'cardiac surgery', 'heart surgery');
  } else if (/medical|device|器械|医疗/.test(lower)) {
    industries.push('medical devices');
    productKeywords.push('medical device');
  }

  if (/saudi|ksa|沙特|riyadh/.test(lower)) {
    locationKeywords.push('Saudi Arabia', 'KSA');
  }
  if (/distributor|经销/.test(lower)) businessTypes.push('distributor');
  if (/importer|进口/.test(lower)) businessTypes.push('importer');
  if (/supplier|供应/.test(lower)) businessTypes.push('supplier');
  if (businessTypes.length === 0) businessTypes.push('distributor', 'supplier');

  return {
    industries: uniqueStrings(industries, 12),
    businessTypes: uniqueStrings(businessTypes, 12),
    productKeywords: uniqueStrings(productKeywords, 16),
    locationKeywords: uniqueStrings(locationKeywords, 12),
    exclusions: [],
  };
}

function pushQuery(out: PlannedQuery[], seen: Set<string>, query: string, rationale: string, priority: number) {
  const key = normalizeQueryKey(query);
  if (!key || seen.has(key) || key.length < 2) return;
  seen.add(key);
  out.push({ query: query.trim(), rationale, priority });
}

/** Deterministic plan so a JSON parse failure cannot block the whole task. */
export function buildFallbackQueryPlan(prompt: string): AcquisitionPlan {
  const q = prompt.trim();
  const seen = new Set<string>();
  const queries: PlannedQuery[] = [];
  const interpretation = inferInterpretation(q);

  pushQuery(queries, seen, q, 'original user prompt', 1);

  const hasDistributor = /\b(distributor|distributors|经销)\b/i.test(q);
  const hasImporter = /\b(importer|importers|进口)\b/i.test(q);
  const hasSupplier = /\b(supplier|suppliers|供应)\b/i.test(q);
  const hasSaudi = /\bsaudi arabia\b/i.test(q);
  const hasKsa = /\bksa\b/i.test(q);
  const hasCardio = /\b(cardiovascular|cardiac|心外|心血管)\b/i.test(q);

  if (hasDistributor && !hasImporter) {
    pushQuery(queries, seen, `${q} importer`, 'importer variation', 2);
  } else if (!hasDistributor) {
    pushQuery(queries, seen, `${q} distributor supplier`, 'business-type expansion', 2);
  } else if (!hasSupplier) {
    pushQuery(queries, seen, `${q} supplier`, 'supplier variation', 2);
  }

  if (hasSaudi && !hasKsa) {
    pushQuery(queries, seen, q.replace(/saudi arabia/gi, 'KSA'), 'location synonym KSA', 3);
  } else if (hasKsa && !hasSaudi) {
    pushQuery(queries, seen, q.replace(/\bksa\b/gi, 'Saudi Arabia'), 'location synonym Saudi Arabia', 3);
  }

  if (hasCardio) {
    if (/cardiovascular/i.test(q)) {
      pushQuery(
        queries,
        seen,
        q.replace(/cardiovascular/gi, 'cardiac surgery'),
        'cardiac specialty variation',
        4,
      );
    } else {
      pushQuery(queries, seen, `${q} cardiovascular device`, 'cardiovascular product expansion', 4);
    }
  }

  if (queries.length < PLAN_QUERY_MIN) {
    pushQuery(queries, seen, `${q} wholesale dealer`, 'wholesale/dealer expansion', 5);
  }
  if (queries.length < PLAN_QUERY_MIN) {
    pushQuery(queries, seen, `${q} hospital equipment`, 'hospital-channel expansion', 6);
  }

  return acquisitionPlanSchema.parse({
    interpretation,
    queries: queries.slice(0, PLAN_QUERY_MAX),
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function defaultLlmCall(input: {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
}): Promise<unknown> {
  const client = getOpenAICompatibleChatClient();
  const result = await withTimeout(
    client.chat({
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      model: input.model,
      maxOutputTokens: input.maxOutputTokens,
      temperature: 0.3,
      jsonMode: true,
    }),
    input.timeoutMs,
    'acquisition-planner-llm',
  );
  return extractJsonObject(result.content);
}

function padPlan(plan: AcquisitionPlan, prompt: string): AcquisitionPlan {
  const fallback = buildFallbackQueryPlan(prompt);
  const merged = dedupePlannedQueries([...plan.queries, ...fallback.queries]);
  return acquisitionPlanSchema.parse({
    interpretation: {
      targetMarket: plan.interpretation.targetMarket || fallback.interpretation.targetMarket,
      industries: uniqueStrings(
        [...plan.interpretation.industries, ...fallback.interpretation.industries],
        12,
      ),
      businessTypes: uniqueStrings(
        [...plan.interpretation.businessTypes, ...fallback.interpretation.businessTypes],
        12,
      ),
      productKeywords: uniqueStrings(
        [...plan.interpretation.productKeywords, ...fallback.interpretation.productKeywords],
        16,
      ),
      locationKeywords: uniqueStrings(
        [...plan.interpretation.locationKeywords, ...fallback.interpretation.locationKeywords],
        12,
      ),
      exclusions: uniqueStrings(
        [...plan.interpretation.exclusions, ...fallback.interpretation.exclusions],
        12,
      ),
    },
    queries: merged.slice(0, PLAN_QUERY_MAX),
  });
}

export type PlanAcquisitionQueriesInput = {
  prompt: string;
  targetCount: number;
  llmCall?: AcquisitionAgentLlmCall;
};

export type PlanAcquisitionQueriesResult = {
  plan: AcquisitionPlan;
  source: 'llm' | 'fallback';
};

export async function planAcquisitionQueries(
  input: PlanAcquisitionQueriesInput,
): Promise<PlanAcquisitionQueriesResult> {
  const prompt = input.prompt.trim();
  const fallback = buildFallbackQueryPlan(prompt);
  const timeoutMs = env.leadAgentLlmTimeoutMs;
  const llmCall = input.llmCall ?? defaultLlmCall;

  const userPrompt = JSON.stringify({
    goal: prompt,
    targetCount: input.targetCount,
    queryCount: { min: PLAN_QUERY_MIN, max: PLAN_QUERY_MAX },
    agentVersion: ACQUISITION_AGENT_VERSION,
  });

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= PLANNER_LLM_ATTEMPTS; attempt += 1) {
    try {
      const raw = await llmCall({
        systemPrompt: PLANNER_SYSTEM_PROMPT,
        userPrompt:
          attempt === 1
            ? userPrompt
            : `${userPrompt}\n\nPrevious output failed schema validation (${lastError}). Return ONLY a valid JSON object with ${PLAN_QUERY_MIN}-${PLAN_QUERY_MAX} diverse queries.`,
        model: getActiveLlmModel(),
        maxOutputTokens: Math.min(env.aiMaxOutputTokens || 2000, 2000),
        timeoutMs,
      });
      const parsed = acquisitionPlanSchema.safeParse(raw);
      if (!parsed.success) {
        lastError = parsed.error.issues
          .slice(0, 3)
          .map((i) => i.message)
          .join('; ');
        logger.warn('[LeadAgent] planner_schema_retry', {
          attempt,
          error: lastError,
        });
        continue;
      }
      const queries = dedupePlannedQueries(parsed.data.queries);
      if (queries.length < PLAN_QUERY_MIN) {
        const padded = padPlan({ ...parsed.data, queries }, prompt);
        return { plan: padded, source: 'llm' };
      }
      return {
        plan: {
          interpretation: parsed.data.interpretation,
          queries: queries.slice(0, PLAN_QUERY_MAX),
        },
        source: 'llm',
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn('[LeadAgent] planner_llm_retry', {
        attempt,
        error: lastError,
      });
    }
  }

  logger.warn('[LeadAgent] planner_fallback', { error: lastError });
  return { plan: fallback, source: 'fallback' };
}

export const acquisitionAgentPlanner = {
  planAcquisitionQueries,
  buildFallbackQueryPlan,
  dedupePlannedQueries,
  PLANNER_SYSTEM_PROMPT,
};
