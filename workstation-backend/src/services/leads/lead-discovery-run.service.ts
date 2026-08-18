/**
 * Lead discovery task lifecycle.
 *
 * HTTP creates a PENDING LeadSearchTask and enqueues a small Redis job.
 * The independent worker runs Acquisition Agent (plan → search → research)
 * then persists and auto-scores. This module does not reimplement providers.
 */
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { env } from '../../config/env';
import * as leadQueue from '../../queues/lead-discovery.queue';
import type { DiscoveryPreviewInput, DiscoveryPreviewResult } from './lead-discovery.service';
import {
  leadPersistenceService,
  type PersistDiscoveryCompanyResult,
  type PersistDiscoveryStats,
} from './lead-persistence.service';
import { acquisitionAgentOrchestrator, getAcquisitionAgentBudget } from './agent/acquisition-agent-orchestrator.service';
import type { AcquisitionAgentRunResult } from './agent/acquisition-agent-orchestrator.service';
import type { LeadSearchTask } from '@prisma/client';
import { prisma } from '../../config/database';
import type { LeadProviderError } from '../../providers/lead-engines/lead-provider.types';
import { providerMetricsStore } from '../../providers/lead-engines/provider-retry';
import { LeadProviderMetricsCollector } from './lead-provider-metrics';
import { isLeadTaskCancelledError } from './lead-task-cancelled.error';
import {
  assertTaskNotCancelled,
  markSearchTaskCancelled,
} from './lead-task-cancel.service';
import { updateLeadTaskProgress, type JobProgressLike } from './lead-task-progress.service';
import type { LeadTaskOutcome, LeadTaskScoringSummary } from './lead-task-progress.types';
import { emptyProgress } from './lead-task-progress.types';
import { leadScoreService } from './lead-score.service';
import { MAX_COMPANIES_PER_TASK_SCORE } from './lead-score.types';

const DEFAULT_TARGET = 5;

export type LeadDiscoveryRunInput = DiscoveryPreviewInput & {
  organizationId: string;
  targetCount?: number;
};

export type LeadDiscoveryTaskView = {
  id: string;
  status: LeadSearchTask['status'];
  query: string;
  prompt: string;
  targetCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
};

export type LeadDiscoveryRunResult = {
  task: LeadDiscoveryTaskView;
  stats: {
    searchResults: number;
    uniqueDomains: number;
    researched: number;
    successful: number;
    pagesScraped: number;
    keeleadVerifyCalls: number;
    savedCompanies: number;
    createdCompanies: number;
    updatedCompanies: number;
    createdContacts: number;
    updatedContacts: number;
    sourceRecords: number;
  };
  companies: PersistDiscoveryCompanyResult[];
  errors: Array<LeadProviderError | { domain?: string; message: string; code: string }>;
  durationMs: number;
};

function parseTargetCount(targetCount?: number, maxCandidates?: number): number {
  const raw = targetCount ?? maxCandidates ?? DEFAULT_TARGET;
  if (!Number.isFinite(raw) || raw < 1) {
    throw new AppError(400, 'targetCount 必须大于 0', 'LEAD_TARGET_COUNT_INVALID');
  }
  if (raw > env.leadMaxTargetCount) {
    throw new AppError(
      400,
      `targetCount 不能超过 ${env.leadMaxTargetCount}`,
      'LEAD_TARGET_COUNT_TOO_LARGE',
    );
  }
  return Math.floor(raw);
}

function requireQueryAndOrg(input: LeadDiscoveryRunInput): {
  query: string;
  organizationId: string;
  targetCount: number;
} {
  const query = input.query.trim();
  if (!query) {
    throw new AppError(400, 'query 必填', 'BAD_REQUEST');
  }
  if (!input.organizationId) {
    throw new AppError(400, 'organizationId 必填', 'ORGANIZATION_REQUIRED');
  }
  return {
    query,
    organizationId: input.organizationId,
    targetCount: parseTargetCount(input.targetCount, input.maxCandidates),
  };
}

function toTaskView(task: LeadSearchTask, query = task.prompt): LeadDiscoveryTaskView {
  return {
    id: task.id,
    status: task.status,
    query,
    prompt: task.prompt,
    targetCount: task.targetCount,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
  };
}

function emptyPersistStats(): PersistDiscoveryStats {
  return {
    savedCompanies: 0,
    createdCompanies: 0,
    updatedCompanies: 0,
    createdContacts: 0,
    updatedContacts: 0,
    sourceRecords: 0,
  };
}

function emptyDiscovery(query: string): DiscoveryPreviewResult {
  return {
    query,
    stats: {
      searchResults: 0,
      uniqueDomains: 0,
      researched: 0,
      successful: 0,
      pagesScraped: 0,
      keeleadVerifyCalls: 0,
    },
    companies: [],
    errors: [],
    durationMs: 0,
  };
}

function agentResultFromUnknown(partial: unknown, query: string): AcquisitionAgentRunResult | null {
  if (!partial || typeof partial !== 'object') return null;
  const row = partial as Partial<AcquisitionAgentRunResult>;
  if (row.discovery && row.agentSummary) return row as AcquisitionAgentRunResult;
  if (row.discovery) {
    return {
      discovery: row.discovery,
      agentSummary: {
        version: 'acquisition-agent-v1',
        requestedTarget: 0,
        effectiveResearchLimit: 0,
        plan: { queryCount: 0, source: 'fallback' },
        executedQueries: [],
        searchRounds: 0,
        uniqueCandidates: row.discovery.stats.uniqueDomains,
        stopReason: 'CANCELLED',
      },
    };
  }
  if (Array.isArray((partial as { companies?: unknown }).companies)) {
    const discovery = {
      ...emptyDiscovery(query),
      companies: (partial as DiscoveryPreviewResult).companies ?? [],
    };
    return {
      discovery,
      agentSummary: {
        version: 'acquisition-agent-v1',
        requestedTarget: 0,
        effectiveResearchLimit: 0,
        plan: { queryCount: 0, source: 'fallback' },
        executedQueries: [],
        searchRounds: 0,
        uniqueCandidates: 0,
        stopReason: 'CANCELLED',
      },
    };
  }
  return null;
}

export async function createLeadDiscoveryTask(
  input: LeadDiscoveryRunInput,
): Promise<LeadSearchTask> {
  const { query, organizationId, targetCount } = requireQueryAndOrg(input);
  return leadPersistenceService.createPendingSearchTask({
    organizationId,
    prompt: query,
    targetCount,
  });
}

/**
 * HTTP entry: persist PENDING task, enqueue, return immediately.
 * Does not run SearXNG / Firecrawl / KeeLead.
 */
export async function startLeadDiscovery(
  input: LeadDiscoveryRunInput,
): Promise<{ task: LeadDiscoveryTaskView }> {
  const { query, organizationId, targetCount } = requireQueryAndOrg(input);
  const researchLimit = env.leadAgentMaxResearchCompanies;

  const active = await prisma.leadSearchTask.count({
    where: {
      organizationId,
      status: { in: ['PENDING', 'RUNNING'] },
    },
  });
  if (active >= env.leadMaxActiveTasksPerOrg) {
    throw new AppError(
      429,
      `组织并发获客任务已达上限（${env.leadMaxActiveTasksPerOrg}）`,
      'LEAD_ORG_ACTIVE_TASK_LIMIT',
    );
  }

  const task = await createLeadDiscoveryTask({
    organizationId,
    query,
    targetCount,
  });

  await updateLeadTaskProgress({
    taskId: task.id,
    organizationId,
    patch: emptyProgress({ phase: 'QUEUED' }),
    extraMetadata: {
      requestedTarget: targetCount,
      effectiveResearchLimit: researchLimit,
    },
  });

  try {
    await leadQueue.enqueueLeadDiscoveryJob({
      taskId: task.id,
      organizationId,
      query,
      targetCount,
      researchLimit,
    });
  } catch (err) {
    await leadPersistenceService.failSearchTask({ taskId: task.id, error: err });
    logger.error('lead_discovery_enqueue_failed', {
      taskId: task.id,
      organizationId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new AppError(503, '获客任务队列不可用', 'LEAD_QUEUE_UNAVAILABLE');
  }

  const pending = await prisma.leadSearchTask.findUniqueOrThrow({ where: { id: task.id } });
  return { task: toTaskView(pending, query) };
}

async function persistThenMaybeScore(params: {
  taskId: string;
  organizationId: string;
  query: string;
  requestedTarget: number;
  agentResult: AcquisitionAgentRunResult;
  collector: LeadProviderMetricsCollector;
  job?: JobProgressLike | null;
  signal?: AbortSignal;
  cancelled: boolean;
}): Promise<{
  persistStats: PersistDiscoveryStats;
  companies: PersistDiscoveryCompanyResult[];
  persistErrors: Array<{ domain?: string; message: string; code: string }>;
  scoring: LeadTaskScoringSummary;
  scored: number;
}> {
  const { discovery, agentSummary } = params.agentResult;
  const emailsFound = discovery.companies.reduce(
    (n, c) => n + (c.contacts.emails?.length ?? 0),
    0,
  );
  await updateLeadTaskProgress({
    taskId: params.taskId,
    organizationId: params.organizationId,
    job: params.job,
    patch: {
      phase: 'PERSISTING',
      uniqueCandidates: agentSummary.uniqueCandidates,
      researched: discovery.stats.researched,
      executedQueries: agentSummary.executedQueries.length,
      emailsFound,
    },
  });

  const persisted = await leadPersistenceService.persistDiscoveryResult({
    organizationId: params.organizationId,
    searchTaskId: params.taskId,
    discovery,
  });

  await updateLeadTaskProgress({
    taskId: params.taskId,
    organizationId: params.organizationId,
    job: params.job,
    patch: { persisted: persisted.stats.savedCompanies },
  });

  const scoring: LeadTaskScoringSummary = {
    status: 'SKIPPED',
    attempted: 0,
    scored: 0,
    failed: 0,
    errors: [],
  };

  if (params.cancelled) {
    return {
      persistStats: persisted.stats,
      companies: persisted.companies,
      persistErrors: persisted.errors,
      scoring,
      scored: 0,
    };
  }

  if (persisted.stats.savedCompanies <= 0) {
    scoring.status = 'SKIPPED';
    return {
      persistStats: persisted.stats,
      companies: persisted.companies,
      persistErrors: persisted.errors,
      scoring,
      scored: 0,
    };
  }

  try {
    await assertTaskNotCancelled({ taskId: params.taskId, signal: params.signal });
  } catch {
    return {
      persistStats: persisted.stats,
      companies: persisted.companies,
      persistErrors: persisted.errors,
      scoring,
      scored: 0,
    };
  }

  await updateLeadTaskProgress({
    taskId: params.taskId,
    organizationId: params.organizationId,
    job: params.job,
    patch: { phase: 'SCORING', persisted: persisted.stats.savedCompanies },
  });

  try {
    const scoreResult = await leadScoreService.scoreSearchTaskCompanies({
      organizationId: params.organizationId,
      searchTaskId: params.taskId,
      maxCompanies: Math.min(
        Math.max(persisted.stats.savedCompanies, 1),
        MAX_COMPANIES_PER_TASK_SCORE,
      ),
      shouldAbort: async () => {
        try {
          await assertTaskNotCancelled({ taskId: params.taskId, signal: params.signal });
          return false;
        } catch {
          return true;
        }
      },
    });
    scoring.attempted = scoreResult.scored + scoreResult.failed;
    scoring.scored = scoreResult.scored;
    scoring.failed = scoreResult.failed;
    scoring.errors = scoreResult.errors.map((e) => ({
      companyId: e.companyId,
      domain: e.domain,
      message: e.message,
    }));
    if (scoreResult.failed === 0) scoring.status = 'OK';
    else if (scoreResult.scored > 0) scoring.status = 'PARTIAL_FAILED';
    else scoring.status = 'FAILED';

    logger.info('[LeadScore]', {
      taskId: params.taskId,
      attempted: scoring.attempted,
      success: scoring.scored,
      failed: scoring.failed,
    });
  } catch (err) {
    if (isLeadTaskCancelledError(err)) {
      return {
        persistStats: persisted.stats,
        companies: persisted.companies,
        persistErrors: persisted.errors,
        scoring,
        scored: scoring.scored,
      };
    }
    scoring.status = 'FAILED';
    scoring.errors.push({
      message: err instanceof Error ? err.message : String(err),
    });
    logger.info('[LeadScore]', {
      taskId: params.taskId,
      attempted: scoring.attempted,
      success: scoring.scored,
      failed: scoring.failed,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await updateLeadTaskProgress({
    taskId: params.taskId,
    organizationId: params.organizationId,
    job: params.job,
    patch: { scored: scoring.scored },
  });

  return {
    persistStats: persisted.stats,
    companies: persisted.companies,
    persistErrors: persisted.errors,
    scoring,
    scored: scoring.scored,
  };
}

function buildOutcome(params: {
  requestedTarget: number;
  acquiredCompanies: number;
  stopReason: string;
  effectiveResearchLimit: number;
}): LeadTaskOutcome {
  return {
    requestedTarget: params.requestedTarget,
    acquiredCompanies: params.acquiredCompanies,
    targetReached: params.acquiredCompanies >= params.requestedTarget,
    stopReason: params.stopReason,
    effectiveResearchLimit: params.effectiveResearchLimit,
  };
}

/**
 * Worker entry: run discovery + persist + auto ICP score for an existing task.
 * Does not mark FAILED on thrown errors — the worker does that only after attempts are exhausted.
 * User cancel is never converted into FAILED and must not trigger BullMQ retry.
 */
export async function executeLeadDiscoveryTask(params: {
  taskId: string;
  organizationId: string;
  query: string;
  targetCount?: number;
  researchLimit?: number;
  maxCandidates?: number;
  job?: JobProgressLike | null;
  signal?: AbortSignal;
}): Promise<LeadDiscoveryRunResult> {
  const started = Date.now();
  const query = params.query.trim();
  const requestedTarget = parseTargetCount(params.targetCount, params.maxCandidates);
  const researchLimit = Math.min(
    Math.max(params.researchLimit ?? env.leadAgentMaxResearchCompanies, 1),
    env.leadAgentMaxResearchCompanies,
  );

  const task = await prisma.leadSearchTask.findUnique({
    where: { id: params.taskId },
  });
  if (!task) {
    throw new AppError(404, '获客任务不存在', 'LEAD_SEARCH_TASK_NOT_FOUND');
  }
  if (task.organizationId !== params.organizationId) {
    throw new AppError(403, '无权访问该获客任务', 'ORGANIZATION_MISMATCH');
  }

  if (task.status === 'COMPLETED') {
    return {
      task: toTaskView(task, query),
      stats: {
        searchResults: task.searchResultsCount,
        uniqueDomains: task.uniqueDomainsCount,
        researched: task.researchedCount,
        successful: task.successfulCount,
        pagesScraped: 0,
        keeleadVerifyCalls: 0,
        ...emptyPersistStats(),
      },
      companies: [],
      errors: [],
      durationMs: Date.now() - started,
    };
  }

  if (task.status === 'CANCELLED' || task.cancelRequestedAt) {
    if (task.status !== 'CANCELLED') {
      await markSearchTaskCancelled({
        taskId: task.id,
        organizationId: params.organizationId,
      });
    }
    const cancelled = await prisma.leadSearchTask.findUniqueOrThrow({ where: { id: task.id } });
    return {
      task: toTaskView(cancelled, query),
      stats: {
        searchResults: cancelled.searchResultsCount,
        uniqueDomains: cancelled.uniqueDomainsCount,
        researched: cancelled.researchedCount,
        successful: cancelled.successfulCount,
        pagesScraped: 0,
        keeleadVerifyCalls: 0,
        ...emptyPersistStats(),
      },
      companies: [],
      errors: [],
      durationMs: Date.now() - started,
    };
  }

  if (task.status === 'FAILED') {
    throw new AppError(409, '获客任务已失败，不再执行', 'LEAD_SEARCH_TASK_FAILED');
  }

  await leadPersistenceService.markSearchTaskRunning(task.id);
  const collector = new LeadProviderMetricsCollector();

  return providerMetricsStore.run(collector, async () => {
    const assertNotCancelled = async () => {
      await assertTaskNotCancelled({ taskId: task.id, signal: params.signal });
    };
    const onProgress = async (patch: Parameters<typeof updateLeadTaskProgress>[0]['patch']) => {
      await updateLeadTaskProgress({
        taskId: task.id,
        organizationId: params.organizationId,
        job: params.job,
        patch,
      });
    };

    logger.info('[LeadTask]', {
      taskId: task.id,
      organizationId: params.organizationId,
      phase: 'RUNNING',
      requestedTarget: task.targetCount || requestedTarget,
    });

    let agentResult: AcquisitionAgentRunResult | null = null;
    let cancelled = false;
    try {
      await assertNotCancelled();
      agentResult = await acquisitionAgentOrchestrator.run(
        {
          taskId: task.id,
          organizationId: params.organizationId,
          prompt: query,
          targetCount: task.targetCount || requestedTarget,
          signal: params.signal,
        },
        {
          assertNotCancelled,
          onProgress,
          budget: {
            ...getAcquisitionAgentBudget(),
            maxResearchCompanies: researchLimit,
          },
        },
      );
    } catch (err) {
      if (!isLeadTaskCancelledError(err)) throw err;
      cancelled = true;
      agentResult = agentResultFromUnknown(err.partial, query);
    }

    if (!agentResult) {
      await markSearchTaskCancelled({
        taskId: task.id,
        organizationId: params.organizationId,
      });
      const cancelledRow = await prisma.leadSearchTask.findUniqueOrThrow({
        where: { id: task.id },
      });
      return {
        task: toTaskView(cancelledRow, query),
        stats: {
          searchResults: 0,
          uniqueDomains: 0,
          researched: 0,
          successful: 0,
          pagesScraped: 0,
          keeleadVerifyCalls: 0,
          ...emptyPersistStats(),
        },
        companies: [],
        errors: [],
        durationMs: Date.now() - started,
      };
    }

    const discovery = agentResult.discovery;
    logger.info('[LeadAgent]', {
      taskId: task.id,
      phase: 'PERSIST',
      uniqueCandidates: agentResult.agentSummary.uniqueCandidates,
      researchCount: discovery.stats.researched,
    });

    let persistOutcome: Awaited<ReturnType<typeof persistThenMaybeScore>>;
    try {
      persistOutcome = await persistThenMaybeScore({
        taskId: task.id,
        organizationId: params.organizationId,
        query,
        requestedTarget: task.targetCount || requestedTarget,
        agentResult,
        collector,
        job: params.job,
        signal: params.signal,
        cancelled,
      });
    } catch (err) {
      if (isLeadTaskCancelledError(err)) {
        cancelled = true;
        persistOutcome = {
          persistStats: emptyPersistStats(),
          companies: [],
          persistErrors: [],
          scoring: {
            status: 'SKIPPED',
            attempted: 0,
            scored: 0,
            failed: 0,
            errors: [],
          },
          scored: 0,
        };
      } else {
        throw err;
      }
    }

    if (cancelled || (await prisma.leadSearchTask.findUnique({
      where: { id: task.id },
      select: { cancelRequestedAt: true, status: true },
    }))?.cancelRequestedAt) {
      await markSearchTaskCancelled({
        taskId: task.id,
        organizationId: params.organizationId,
      });
      const cancelledRow = await prisma.leadSearchTask.findUniqueOrThrow({
        where: { id: task.id },
      });
      return {
        task: toTaskView(cancelledRow, query),
        stats: {
          searchResults: discovery.stats.searchResults,
          uniqueDomains: discovery.stats.uniqueDomains,
          researched: discovery.stats.researched,
          successful: discovery.stats.successful,
          pagesScraped: discovery.stats.pagesScraped,
          keeleadVerifyCalls: discovery.stats.keeleadVerifyCalls,
          ...persistOutcome.persistStats,
        },
        companies: persistOutcome.companies,
        errors: [...discovery.errors, ...persistOutcome.persistErrors],
        durationMs: Date.now() - started,
      };
    }

    const outcome = buildOutcome({
      requestedTarget: agentResult.agentSummary.requestedTarget,
      acquiredCompanies: persistOutcome.persistStats.savedCompanies,
      stopReason: agentResult.agentSummary.stopReason,
      effectiveResearchLimit: agentResult.agentSummary.effectiveResearchLimit,
    });

    await updateLeadTaskProgress({
      taskId: task.id,
      organizationId: params.organizationId,
      job: params.job,
      patch: {
        phase: 'COMPLETED',
        persisted: persistOutcome.persistStats.savedCompanies,
        scored: persistOutcome.scored,
        researched: discovery.stats.researched,
        uniqueCandidates: agentResult.agentSummary.uniqueCandidates,
        executedQueries: agentResult.agentSummary.executedQueries.length,
      },
    });

    const completed = await leadPersistenceService.completeSearchTask({
      taskId: task.id,
      discovery,
      persistStats: persistOutcome.persistStats,
      agentSummary: agentResult.agentSummary,
      extraMetadata: {
        requestedTarget: agentResult.agentSummary.requestedTarget,
        effectiveResearchLimit: agentResult.agentSummary.effectiveResearchLimit,
        executedQueries: agentResult.agentSummary.executedQueries,
        searchRounds: agentResult.agentSummary.searchRounds,
        uniqueCandidates: agentResult.agentSummary.uniqueCandidates,
        stopReason: agentResult.agentSummary.stopReason,
        outcome,
        scoring: persistOutcome.scoring,
        providerMetrics: collector.snapshot(),
      },
    });
    if (completed.status === 'CANCELLED') {
      return {
        task: toTaskView(completed, query),
        stats: {
          searchResults: discovery.stats.searchResults,
          uniqueDomains: discovery.stats.uniqueDomains,
          researched: discovery.stats.researched,
          successful: discovery.stats.successful,
          pagesScraped: discovery.stats.pagesScraped,
          keeleadVerifyCalls: discovery.stats.keeleadVerifyCalls,
          ...persistOutcome.persistStats,
        },
        companies: persistOutcome.companies,
        errors: [...discovery.errors, ...persistOutcome.persistErrors],
        durationMs: Date.now() - started,
      };
    }

    logger.info('[LeadTask]', {
      taskId: completed.id,
      organizationId: params.organizationId,
      phase: 'COMPLETED',
      savedCompanies: persistOutcome.persistStats.savedCompanies,
      durationMs: Date.now() - started,
    });

    return {
      task: toTaskView(completed, query),
      stats: {
        searchResults: discovery.stats.searchResults,
        uniqueDomains: discovery.stats.uniqueDomains,
        researched: discovery.stats.researched,
        successful: discovery.stats.successful,
        pagesScraped: discovery.stats.pagesScraped,
        keeleadVerifyCalls: discovery.stats.keeleadVerifyCalls,
        ...persistOutcome.persistStats,
      },
      companies: persistOutcome.companies,
      errors: [...discovery.errors, ...persistOutcome.persistErrors],
      durationMs: Date.now() - started,
    };
  });
}

/**
 * In-process sync helper for smoke scripts / tests. Not used by HTTP.
 * Does not mark FAILED on error (same as the worker processor).
 */
export async function runLeadDiscovery(
  input: LeadDiscoveryRunInput,
): Promise<LeadDiscoveryRunResult> {
  const { query, organizationId, targetCount } = requireQueryAndOrg(input);
  const task = await createLeadDiscoveryTask({
    organizationId,
    query,
    targetCount,
  });
  return executeLeadDiscoveryTask({
    taskId: task.id,
    organizationId,
    query,
    targetCount,
    researchLimit: env.leadAgentMaxResearchCompanies,
  });
}

export const leadDiscoveryRunService = {
  createLeadDiscoveryTask,
  startLeadDiscovery,
  executeLeadDiscoveryTask,
  runLeadDiscovery,
};
