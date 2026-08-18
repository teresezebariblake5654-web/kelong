export const LEAD_TASK_PHASES = [
  'QUEUED',
  'PLANNING',
  'SEARCHING',
  'EVALUATING',
  'RESEARCHING',
  'VERIFYING',
  'PERSISTING',
  'SCORING',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const;

export type LeadTaskPhase = (typeof LEAD_TASK_PHASES)[number];

export type LeadTaskProgressCounters = {
  queriesExecuted: number;
  uniqueCandidates: number;
  candidatesResearched: number;
  emailsFound: number;
  companiesPersisted: number;
  companiesScored: number;
};

export type LeadTaskProgress = {
  phase: LeadTaskPhase;
  updatedAt: string;
  searchRound?: number;
  maxQueries?: number;
  counters: LeadTaskProgressCounters;
  /** @deprecated flattened aliases kept so Orchestrator patches still merge. */
  executedQueries?: number;
  uniqueCandidates?: number;
  researched?: number;
  persisted?: number;
  scored?: number;
};

export type LeadTaskOutcome = {
  requestedTarget: number;
  acquiredCompanies: number;
  targetReached: boolean;
  stopReason: string;
  effectiveResearchLimit: number;
};

export type LeadTaskScoringSummary = {
  status: 'SKIPPED' | 'OK' | 'PARTIAL_FAILED' | 'FAILED';
  attempted: number;
  scored: number;
  failed: number;
  errors: Array<{ companyId?: string; domain?: string; message: string }>;
};

/** Root metadata keys that progress updates must never drop. */
export const LEAD_METADATA_STABLE_KEYS = [
  'requestedTarget',
  'effectiveResearchLimit',
  'executedQueries',
  'searchRounds',
  'uniqueCandidates',
  'stopReason',
  'acquisitionAgent',
  'outcome',
  'scoring',
  'providerMetrics',
  'persist',
] as const;

export function emptyCounters(
  overrides?: Partial<LeadTaskProgressCounters>,
): LeadTaskProgressCounters {
  return {
    queriesExecuted: 0,
    uniqueCandidates: 0,
    candidatesResearched: 0,
    emailsFound: 0,
    companiesPersisted: 0,
    companiesScored: 0,
    ...overrides,
  };
}

function asNum(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeProgress(raw: unknown): LeadTaskProgress {
  const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const countersRaw =
    row.counters && typeof row.counters === 'object' && !Array.isArray(row.counters)
      ? (row.counters as Record<string, unknown>)
      : {};
  const counters = emptyCounters({
    queriesExecuted: asNum(countersRaw.queriesExecuted, asNum(row.executedQueries)),
    uniqueCandidates: asNum(countersRaw.uniqueCandidates, asNum(row.uniqueCandidates)),
    candidatesResearched: asNum(countersRaw.candidatesResearched, asNum(row.researched)),
    emailsFound: asNum(countersRaw.emailsFound),
    companiesPersisted: asNum(countersRaw.companiesPersisted, asNum(row.persisted)),
    companiesScored: asNum(countersRaw.companiesScored, asNum(row.scored)),
  });
  const phase = LEAD_TASK_PHASES.includes(row.phase as LeadTaskPhase)
    ? (row.phase as LeadTaskPhase)
    : 'QUEUED';
  return {
    phase,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
    searchRound: asNum(row.searchRound, 0),
    maxQueries: asNum(row.maxQueries, 0),
    counters,
    executedQueries: counters.queriesExecuted,
    uniqueCandidates: counters.uniqueCandidates,
    researched: counters.candidatesResearched,
    persisted: counters.companiesPersisted,
    scored: counters.companiesScored,
  };
}

export function emptyProgress(overrides?: Partial<LeadTaskProgress>): LeadTaskProgress {
  return normalizeProgress({
    phase: 'QUEUED',
    searchRound: 0,
    maxQueries: 0,
    ...overrides,
    counters: {
      ...emptyCounters(),
      ...(overrides?.counters ?? {}),
    },
  });
}

export function mergeProgressPatch(
  prev: LeadTaskProgress,
  patch: Partial<LeadTaskProgress> & {
    executedQueries?: number;
    uniqueCandidates?: number;
    researched?: number;
    persisted?: number;
    scored?: number;
    emailsFound?: number;
  },
): LeadTaskProgress {
  const counters = emptyCounters({
    ...prev.counters,
    ...(patch.counters ?? {}),
  });
  if (typeof patch.executedQueries === 'number') counters.queriesExecuted = patch.executedQueries;
  if (typeof patch.uniqueCandidates === 'number') counters.uniqueCandidates = patch.uniqueCandidates;
  if (typeof patch.researched === 'number') counters.candidatesResearched = patch.researched;
  if (typeof patch.persisted === 'number') counters.companiesPersisted = patch.persisted;
  if (typeof patch.scored === 'number') counters.companiesScored = patch.scored;
  if (typeof patch.emailsFound === 'number') counters.emailsFound = patch.emailsFound;
  return normalizeProgress({
    ...prev,
    ...patch,
    counters,
    updatedAt: new Date().toISOString(),
  });
}

export function publicProgress(progress: LeadTaskProgress | null | undefined): {
  phase: LeadTaskPhase;
  updatedAt: string;
  counters: LeadTaskProgressCounters;
} | null {
  if (!progress) return null;
  const n = normalizeProgress(progress);
  return {
    phase: n.phase,
    updatedAt: n.updatedAt,
    counters: n.counters,
  };
}
