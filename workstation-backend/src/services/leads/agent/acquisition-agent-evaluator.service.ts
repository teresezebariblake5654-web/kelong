/**
 * Evaluator: inspect real candidate-pool stats and decide whether to continue searching.
 * Does not invent companies or override hard budgets.
 */
import { env } from '../../../config/env';
import {
  extractJsonObject,
  getActiveLlmModel,
  getOpenAICompatibleChatClient,
} from '../../../providers/llm';
import { logger } from '../../../utils/logger';
import {
  EVALUATOR_LLM_ATTEMPTS,
  SUPPLEMENTAL_QUERY_MAX,
  evaluatorDecisionSchema,
  type AcquisitionAgentLlmCall,
  type EvaluatorDecision,
  type EvaluatorInput,
} from './acquisition-agent.types';

export const EVALUATOR_SYSTEM_PROMPT = `You are a B2B lead-acquisition search evaluator.

You receive ONLY real search-pool statistics. You must NOT invent companies, domains, or search results.
You do NOT search the web. You do NOT decide budgets, organizationId, or taskId.

Return ONLY a JSON object:
{
  "enoughCandidates": boolean,
  "shouldContinueSearching": boolean,
  "reason": string,
  "supplementalQueries": string[]
}

Rules:
- If uniqueCandidateCount already meets or exceeds requestedTarget, set enoughCandidates=true and shouldContinueSearching=false.
- If uniqueCandidateCount is below requestedTarget, you MAY set shouldContinueSearching=true.
- supplementalQueries: at most ${SUPPLEMENTAL_QUERY_MAX}, meaningfully different from queryHistory, English web queries.
- If you should not continue, return an empty supplementalQueries array.
- Short reason only. No chain-of-thought.`;

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
      temperature: 0.2,
      jsonMode: true,
    }),
    input.timeoutMs,
    'acquisition-evaluator-llm',
  );
  return extractJsonObject(result.content);
}

export function buildDeterministicEvaluatorDecision(input: EvaluatorInput): EvaluatorDecision {
  const enough = input.uniqueCandidateCount >= input.requestedTarget;
  return evaluatorDecisionSchema.parse({
    enoughCandidates: enough,
    shouldContinueSearching: !enough,
    reason: enough
      ? `unique candidates ${input.uniqueCandidateCount} meet requested target ${input.requestedTarget}`
      : `unique candidates ${input.uniqueCandidateCount} below requested target ${input.requestedTarget}`,
    supplementalQueries: [],
  });
}

function sanitizeSupplemental(queries: string[], history: string[]): string[] {
  const seen = new Set(history.map((q) => q.toLowerCase().replace(/\s+/g, ' ').trim()));
  const out: string[] = [];
  for (const raw of queries) {
    const q = raw.trim();
    const key = q.toLowerCase().replace(/\s+/g, ' ');
    if (q.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= SUPPLEMENTAL_QUERY_MAX) break;
  }
  return out;
}

export type EvaluateAcquisitionProgressInput = EvaluatorInput & {
  llmCall?: AcquisitionAgentLlmCall;
};

export type EvaluateAcquisitionProgressResult = {
  decision: EvaluatorDecision;
  source: 'llm' | 'fallback';
};

export async function evaluateAcquisitionProgress(
  input: EvaluateAcquisitionProgressInput,
): Promise<EvaluateAcquisitionProgressResult> {
  const deterministic = buildDeterministicEvaluatorDecision(input);
  if (deterministic.enoughCandidates) {
    return { decision: deterministic, source: 'fallback' };
  }

  const timeoutMs = env.leadAgentLlmTimeoutMs;
  const llmCall = input.llmCall ?? defaultLlmCall;
  const userPrompt = JSON.stringify({
    requestedTarget: input.requestedTarget,
    uniqueCandidateCount: input.uniqueCandidateCount,
    researchedCount: input.researchedCount,
    queryHistory: input.queryHistory,
    topDomains: input.topDomains.slice(0, 15),
    domainSignals: input.domainSignals,
  });

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= EVALUATOR_LLM_ATTEMPTS; attempt += 1) {
    try {
      const raw = await llmCall({
        systemPrompt: EVALUATOR_SYSTEM_PROMPT,
        userPrompt:
          attempt === 1
            ? userPrompt
            : `${userPrompt}\n\nPrevious output failed schema validation (${lastError}). Return ONLY a valid JSON object. supplementalQueries max ${SUPPLEMENTAL_QUERY_MAX}.`,
        model: getActiveLlmModel(),
        maxOutputTokens: Math.min(env.aiMaxOutputTokens || 800, 800),
        timeoutMs,
      });
      const parsed = evaluatorDecisionSchema.safeParse(raw);
      if (!parsed.success) {
        lastError = parsed.error.issues
          .slice(0, 3)
          .map((i) => i.message)
          .join('; ');
        logger.warn('[LeadAgent] evaluator_schema_retry', {
          attempt,
          error: lastError,
        });
        continue;
      }
      const supplementalQueries = sanitizeSupplemental(
        parsed.data.supplementalQueries,
        input.queryHistory,
      );
      const enough = input.uniqueCandidateCount >= input.requestedTarget;
      return {
        decision: {
          enoughCandidates: enough || parsed.data.enoughCandidates,
          shouldContinueSearching: enough ? false : parsed.data.shouldContinueSearching,
          reason: parsed.data.reason,
          supplementalQueries: enough ? [] : supplementalQueries,
        },
        source: 'llm',
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn('[LeadAgent] evaluator_llm_retry', {
        attempt,
        error: lastError,
      });
    }
  }

  logger.warn('[LeadAgent] evaluator_fallback', { error: lastError });
  return { decision: deterministic, source: 'fallback' };
}

export const acquisitionAgentEvaluator = {
  evaluateAcquisitionProgress,
  buildDeterministicEvaluatorDecision,
  EVALUATOR_SYSTEM_PROMPT,
};
