import { prisma } from '../../config/database';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { LeadTaskCancelledError } from './lead-task-cancelled.error';
import { updateLeadTaskProgress } from './lead-task-progress.service';

export async function isCancellationRequested(taskId: string): Promise<boolean> {
  const task = await prisma.leadSearchTask.findUnique({
    where: { id: taskId },
    select: { status: true, cancelRequestedAt: true },
  });
  if (!task) return false;
  return task.status === 'CANCELLED' || !!task.cancelRequestedAt;
}

export async function assertTaskNotCancelled(params: {
  taskId: string;
  signal?: AbortSignal;
}): Promise<void> {
  if (params.signal?.aborted) {
    throw new LeadTaskCancelledError();
  }
  if (await isCancellationRequested(params.taskId)) {
    throw new LeadTaskCancelledError();
  }
}

export async function markSearchTaskCancelled(params: {
  taskId: string;
  organizationId?: string;
}): Promise<void> {
  const existing = await prisma.leadSearchTask.findUnique({ where: { id: params.taskId } });
  if (!existing) return;
  if (existing.status === 'CANCELLED') return;
  const now = new Date();
  await prisma.leadSearchTask.update({
    where: { id: params.taskId },
    data: {
      status: 'CANCELLED',
      cancelledAt: existing.cancelledAt ?? now,
      cancelRequestedAt: existing.cancelRequestedAt ?? now,
      completedAt: existing.completedAt ?? now,
    },
  });
  await updateLeadTaskProgress({
    taskId: params.taskId,
    organizationId: params.organizationId ?? existing.organizationId,
    patch: { phase: 'CANCELLED' },
  });
  logger.info('[LeadTask]', {
    taskId: params.taskId,
    organizationId: params.organizationId ?? existing.organizationId,
    phase: 'CANCELLED',
  });
}

export type CancelLeadSearchTaskResult = {
  id: string;
  status: 'CANCELLED' | 'RUNNING' | 'PENDING';
  cancelRequestedAt: Date | null;
  cancelledAt: Date | null;
};

export async function cancelLeadSearchTask(params: {
  organizationId: string;
  taskId: string;
  removeQueuedJob?: (taskId: string) => Promise<boolean>;
}): Promise<CancelLeadSearchTaskResult> {
  const task = await prisma.leadSearchTask.findUnique({ where: { id: params.taskId } });
  if (!task) {
    throw new AppError(404, '获客任务不存在', 'LEAD_SEARCH_TASK_NOT_FOUND');
  }
  if (task.organizationId !== params.organizationId) {
    throw new AppError(403, '无权访问该获客任务', 'ORGANIZATION_MISMATCH');
  }
  if (task.status === 'COMPLETED') {
    throw new AppError(409, '任务已完成，无法取消', 'LEAD_TASK_ALREADY_COMPLETED');
  }
  if (task.status === 'FAILED') {
    throw new AppError(409, '任务已失败，无法取消', 'LEAD_TASK_ALREADY_FAILED');
  }
  if (task.status === 'CANCELLED') {
    return {
      id: task.id,
      status: 'CANCELLED',
      cancelRequestedAt: task.cancelRequestedAt,
      cancelledAt: task.cancelledAt,
    };
  }

  const now = new Date();
  await prisma.leadSearchTask.update({
    where: { id: task.id },
    data: {
      cancelRequestedAt: task.cancelRequestedAt ?? now,
    },
  });

  if (task.status === 'PENDING') {
    const removed = params.removeQueuedJob ? await params.removeQueuedJob(task.id) : true;
    if (removed) {
      await markSearchTaskCancelled({
        taskId: task.id,
        organizationId: params.organizationId,
      });
      const cancelled = await prisma.leadSearchTask.findUniqueOrThrow({ where: { id: task.id } });
      return {
        id: cancelled.id,
        status: 'CANCELLED',
        cancelRequestedAt: cancelled.cancelRequestedAt,
        cancelledAt: cancelled.cancelledAt,
      };
    }
  }

  const running = await prisma.leadSearchTask.findUniqueOrThrow({ where: { id: task.id } });
  logger.info('[LeadTask]', {
    taskId: task.id,
    organizationId: params.organizationId,
    phase: running.status,
    cancelRequested: true,
  });
  return {
    id: running.id,
    status: running.status === 'PENDING' ? 'PENDING' : 'RUNNING',
    cancelRequestedAt: running.cancelRequestedAt,
    cancelledAt: running.cancelledAt,
  };
}
