/**
 * Acquisition Agent structured types.
 * Agent outputs decisions only — never DB writes, HTTP, or budget overrides.
 */
import { z } from 'zod';

export const ACQUISITION_AGENT_VERSION = 'acquisition-agent-v1';

export const PLAN_QUERY_MIN = 3;
export const PLAN_QUERY_MAX = 8;
export const SUPPLEMENTAL_QUERY_MAX = 3;
export const PLANNER_LLM_ATTEMPTS = 3;
export const EVALUATOR_LLM_ATTEMPTS = 2;

export type AcquisitionStopReason =
  | 'TARGET_REACHED'
  | 'MAX_QUERIES'
  | 'MAX_ROUNDS'
  | 'NO_NEW_DOMAINS'
  | 'LLM_FAILURES'
  | 'NO_MORE_QUERIES'
  | 'ABORTED'
  | 'CANCELLED';

export type AcquisitionAgentBudget = {
  maxSearchRounds: number;
  maxQueriesPerRound: number;
  maxTotalQueries: number;
  maxResearchCompanies: number;
  llmTimeoutMs: number;
};

export const plannedQuerySchema = z.object({
  query: z.string().trim().min(2).max(300),
  rationale: z.string().trim().min(1).max(240),
  priority: z.number().int().min(1).max(100),
});

export const planInterpretationSchema = z.object({
  targetMarket: z.string().trim().max(200).optional(),
  industries: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  businessTypes: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  productKeywords: z.array(z.string().trim().min(1).max(80)).max(16).default([]),
  locationKeywords: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  exclusions: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
});

export const acquisitionPlanSchema = z.object({
  interpretation: planInterpretationSchema.default({
    industries: [],
    businessTypes: [],
    productKeywords: [],
    locationKeywords: [],
    exclusions: [],
  }),
  queries: z.array(plannedQuerySchema).min(PLAN_QUERY_MIN).max(PLAN_QUERY_MAX),
});

export type PlannedQuery = z.infer<typeof plannedQuerySchema>;
export type PlanInterpretation = z.infer<typeof planInterpretationSchema>;
export type AcquisitionPlan = z.infer<typeof acquisitionPlanSchema>;

export const evaluatorDecisionSchema = z.object({
  enoughCandidates: z.boolean(),
  shouldContinueSearching: z.boolean(),
  reason: z.string().trim().min(1).max(400),
  supplementalQueries: z.array(z.string().trim().min(2).max(300)).max(SUPPLEMENTAL_QUERY_MAX).default([]),
});

export type EvaluatorDecision = z.infer<typeof evaluatorDecisionSchema>;

export type EvaluatorInput = {
  requestedTarget: number;
  uniqueCandidateCount: number;
  researchedCount: number;
  queryHistory: string[];
  topDomains: string[];
  domainSignals: {
    companyLikely: number;
    directoryLikely: number;
  };
};

export type AgentCandidateProvenance = {
  query: string;
  url: string;
  title: string;
  description: string;
  engine: string;
  rank: number;
};

export type AgentCandidate = {
  domain: string;
  normalizedDomain: string;
  website: string;
  title: string;
  snippet: string;
  candidateKind: 'company_likely' | 'directory_likely';
  provenances: AgentCandidateProvenance[];
  researched: boolean;
};

export type ExecutedQuerySummary = {
  query: string;
  newDomains: number;
  hitCount: number;
  error?: string;
};

export type AcquisitionAgentSummary = {
  version: typeof ACQUISITION_AGENT_VERSION;
  requestedTarget: number;
  effectiveResearchLimit: number;
  plan: {
    queryCount: number;
    source: 'llm' | 'fallback';
  };
  executedQueries: ExecutedQuerySummary[];
  searchRounds: number;
  uniqueCandidates: number;
  stopReason: AcquisitionStopReason;
};

export type AcquisitionAgentLlmCall = (input: {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
}) => Promise<unknown>;
