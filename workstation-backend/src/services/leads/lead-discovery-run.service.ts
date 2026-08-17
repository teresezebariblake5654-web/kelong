/**
 * Lead discovery task lifecycle.
 *
 * HTTP creates a PENDING LeadSearchTask and enqueues a small Redis job.
 * The independent worker executes the existing SearXNG → Firecrawl → KeeLead
 * pipeline; this module does not reimplement providers.
 */
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import * as leadQueue from '../../queues/lead-discovery.queue';
import {
  leadDiscoveryService,
  type DiscoveryPreviewInput,
  type DiscoveryPreviewResult,
} from './lead-discovery.service';
import {
  leadPersistenceService,
  type PersistDiscoveryCompanyResult,
  type PersistDiscoveryStats,
} from './lead-persistence.service';
import type { LeadSearchTask } from '@prisma/client';
import { prisma } from '../../config/database';
import type { LeadProviderError } from '../../providers/lead-engines/lead-provider.types';

const DEFAULT_MAX = 5;
const MAX_HARD = 5;

export type LeadDiscoveryRunInput = DiscoveryPreviewInput & {
  organizationId: string;
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

function clampMaxCandidates(maxCandidates?: number): number {
  return Math.min(Math.max(maxCandidates ?? DEFAULT_MAX, 1), MAX_HARD);
}

function requireQueryAndOrg(input: LeadDiscoveryRunInput): {
  query: string;
  organizationId: string;
  maxCandidates: number;
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
    maxCandidates: clampMaxCandidates(input.maxCandidates),
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

export async function createLeadDiscoveryTask(
  input: LeadDiscoveryRunInput,
): Promise<LeadSearchTask> {
  const { query, organizationId, maxCandidates } = requireQueryAndOrg(input);
  return leadPersistenceService.createPendingSearchTask({
    organizationId,
    prompt: query,
    targetCount: maxCandidates,
  });
}

/**
 * HTTP entry: persist PENDING task, enqueue, return immediately.
 * Does not run SearXNG / Firecrawl / KeeLead.
 */
export async function startLeadDiscovery(
  input: LeadDiscoveryRunInput,
): Promise<{ task: LeadDiscoveryTaskView }> {
  const { query, organizationId, maxCandidates } = requireQueryAndOrg(input);
  const task = await createLeadDiscoveryTask({
    organizationId,
    query,
    maxCandidates,
  });

  try {
    await leadQueue.enqueueLeadDiscoveryJob({
      taskId: task.id,
      organizationId,
      query,
      maxCandidates,
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

/**
 * Worker entry: run the existing discovery + persist pipeline for an existing task.
 * Does not mark FAILED on thrown errors — the worker does that only after attempts are exhausted.
 */
export async function executeLeadDiscoveryTask(params: {
  taskId: string;
  organizationId: string;
  query: string;
  maxCandidates?: number;
}): Promise<LeadDiscoveryRunResult> {
  const started = Date.now();
  const query = params.query.trim();
  const maxCandidates = clampMaxCandidates(params.maxCandidates);

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

  if (task.status === 'FAILED') {
    throw new AppError(409, '获客任务已失败，不再执行', 'LEAD_SEARCH_TASK_FAILED');
  }

  await leadPersistenceService.markSearchTaskRunning(task.id);

  let discovery: DiscoveryPreviewResult | null = null;
  let persistStats: PersistDiscoveryStats = emptyPersistStats();
  let companies: PersistDiscoveryCompanyResult[] = [];
  let persistErrors: Array<{ domain?: string; message: string; code: string }> = [];

  logger.info('lead_discovery_execute_start', {
    taskId: task.id,
    organizationId: params.organizationId,
    maxCandidates,
  });

  discovery = await leadDiscoveryService.runDiscoveryPreview({
    query,
    maxCandidates,
  });

  const persisted = await leadPersistenceService.persistDiscoveryResult({
    organizationId: params.organizationId,
    searchTaskId: task.id,
    discovery,
  });
  persistStats = persisted.stats;
  companies = persisted.companies;
  persistErrors = persisted.errors;

  const completed = await leadPersistenceService.completeSearchTask({
    taskId: task.id,
    discovery,
    persistStats,
  });

  logger.info('lead_discovery_execute_completed', {
    taskId: completed.id,
    organizationId: params.organizationId,
    savedCompanies: persistStats.savedCompanies,
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
      ...persistStats,
    },
    companies,
    errors: [...discovery.errors, ...persistErrors],
    durationMs: Date.now() - started,
  };
}

/**
 * In-process sync helper for smoke scripts / tests. Not used by HTTP.
 * Does not mark FAILED on error (same as the worker processor).
 */
export async function runLeadDiscovery(
  input: LeadDiscoveryRunInput,
): Promise<LeadDiscoveryRunResult> {
  const { query, organizationId, maxCandidates } = requireQueryAndOrg(input);
  const task = await createLeadDiscoveryTask({
    organizationId,
    query,
    maxCandidates,
  });
  return executeLeadDiscoveryTask({
    taskId: task.id,
    organizationId,
    query,
    maxCandidates,
  });
}

export const leadDiscoveryRunService = {
  createLeadDiscoveryTask,
  startLeadDiscovery,
  executeLeadDiscoveryTask,
  runLeadDiscovery,
};
