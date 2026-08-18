import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import {
  mergeProgressPatch,
  normalizeProgress,
  type LeadTaskProgress,
} from './lead-task-progress.types';

export type JobProgressLike = {
  updateProgress?: (value: number | object) => Promise<unknown>;
};

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

export async function updateLeadTaskProgress(params: {
  taskId: string;
  organizationId?: string;
  patch: Partial<LeadTaskProgress> & {
    executedQueries?: number;
    uniqueCandidates?: number;
    researched?: number;
    persisted?: number;
    scored?: number;
    emailsFound?: number;
  };
  extraMetadata?: Record<string, unknown>;
  job?: JobProgressLike | null;
}): Promise<LeadTaskProgress> {
  const existing = await prisma.leadSearchTask.findUnique({
    where: { id: params.taskId },
    select: { metadata: true, organizationId: true, status: true },
  });
  const prevMeta = asObject(existing?.metadata);
  if (existing?.status === 'CANCELLED' && params.patch.phase !== 'CANCELLED') {
    return normalizeProgress(prevMeta.progress);
  }
  const next = mergeProgressPatch(normalizeProgress(prevMeta.progress), params.patch);

  await prisma.leadSearchTask.update({
    where: { id: params.taskId },
    data: {
      metadata: {
        ...prevMeta,
        ...(params.extraMetadata ?? {}),
        progress: next,
      } as Prisma.InputJsonValue,
    },
  });

  logger.info('[LeadTask]', {
    taskId: params.taskId,
    organizationId: params.organizationId ?? existing?.organizationId,
    phase: next.phase,
    queriesExecuted: next.counters.queriesExecuted,
    uniqueCandidates: next.counters.uniqueCandidates,
    candidatesResearched: next.counters.candidatesResearched,
    companiesPersisted: next.counters.companiesPersisted,
    companiesScored: next.counters.companiesScored,
  });

  try {
    await params.job?.updateProgress?.(next);
  } catch {
    // Redis progress is operational only; DB is canonical.
  }
  return next;
}

export const leadTaskProgressService = {
  updateLeadTaskProgress,
};
