import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { leadDiscoveryService } from '../services/leads/lead-discovery.service';
import { leadDiscoveryRunService } from '../services/leads/lead-discovery-run.service';
import { leadScoreService } from '../services/leads/lead-score.service';
import { leadPoolService } from '../services/leads/lead-pool.service';
import { cancelLeadSearchTask } from '../services/leads/lead-task-cancel.service';
import { getLeadProviderHealth } from '../services/leads/lead-provider-health.service';
import { removeLeadDiscoveryJobIfInactive } from '../queues/lead-discovery.queue';
import {
  searchTaskListQuerySchema,
  searchTaskResultsQuerySchema,
} from '../services/leads/lead-pool.types';
import { AppError } from '../utils/errors';

const previewBodySchema = z
  .object({
    query: z.string().trim().min(2).max(500),
    maxCandidates: z.coerce.number().int().min(1).max(5).optional(),
    targetCount: z.coerce.number().int().min(1).max(5).optional(),
  })
  .strict();

const discoveryBodySchema = z
  .object({
    query: z.string().trim().min(2).max(500),
    maxCandidates: z.coerce.number().int().min(1).max(5).optional(),
    /** Upper bound is LEAD_MAX_TARGET_COUNT in the service (4xx, never silent clamp). */
    targetCount: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

const scoreTaskBodySchema = z
  .object({
    maxCompanies: z.coerce.number().int().min(1).max(20).optional(),
  })
  .strict();

export const leadsController = {
  /** Dry-run: never writes leads to PostgreSQL. */
  async discoveryPreview(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, '请先登录', 'UNAUTHORIZED');
      }
      if (!req.org?.organizationId) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }

      const parsed = previewBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError(400, 'query 必填；maxCandidates 可选 1-5', 'BAD_REQUEST');
      }

      const data = await leadDiscoveryService.runDiscoveryPreview(parsed.data);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Create a PENDING LeadSearchTask, enqueue, return immediately (202).
   * The worker runs Acquisition Agent (plan → search → research → persist).
   */
  async discovery(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, '请先登录', 'UNAUTHORIZED');
      }
      if (!req.org?.organizationId) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }

      const parsed = discoveryBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError(
          400,
          `query 必填；maxCandidates 可选 1-5；targetCount 可选 1-${env.leadMaxTargetCount}`,
          'BAD_REQUEST',
        );
      }

      const data = await leadDiscoveryRunService.startLeadDiscovery({
        organizationId: req.org.organizationId,
        ...parsed.data,
      });
      res.status(202).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  /** Read-only: single SearchTask status for current organization. */
  async getSearchTask(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, '请先登录', 'UNAUTHORIZED');
      }
      if (!req.org?.organizationId) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }

      const taskId = String(req.params.taskId || '').trim();
      if (!taskId) {
        throw new AppError(400, 'taskId 必填', 'BAD_REQUEST');
      }

      const data = await leadPoolService.getSearchTask({
        organizationId: req.org.organizationId,
        searchTaskId: taskId,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async cancelSearchTask(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, '请先登录', 'UNAUTHORIZED');
      }
      if (!req.org?.organizationId) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }

      const taskId = String(req.params.taskId || '').trim();
      if (!taskId) {
        throw new AppError(400, 'taskId 必填', 'BAD_REQUEST');
      }

      const data = await cancelLeadSearchTask({
        organizationId: req.org.organizationId,
        taskId,
        removeQueuedJob: removeLeadDiscoveryJobIfInactive,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async providerHealth(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, '请先登录', 'UNAUTHORIZED');
      }
      if (!req.org?.organizationId) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }

      const health = await getLeadProviderHealth();
      res.json({
        success: true,
        data: {
          searxng: { status: health.searxng.status, latencyMs: health.searxng.latencyMs },
          firecrawl: { status: health.firecrawl.status, latencyMs: health.firecrawl.latencyMs },
          keelead: { status: health.keelead.status, latencyMs: health.keelead.latencyMs },
        },
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * ICP score companies already discovered for a SearchTask.
   * Separate from discovery — temporary synchronous implementation.
   */
  async scoreSearchTask(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, '请先登录', 'UNAUTHORIZED');
      }
      if (!req.org?.organizationId) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }

      const taskId = String(req.params.taskId || '').trim();
      if (!taskId) {
        throw new AppError(400, 'taskId 必填', 'BAD_REQUEST');
      }

      const parsed = scoreTaskBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError(400, 'maxCompanies 可选 1-20', 'BAD_REQUEST');
      }

      const data = await leadScoreService.scoreSearchTaskCompanies({
        organizationId: req.org.organizationId,
        searchTaskId: taskId,
        maxCompanies: parsed.data.maxCompanies,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  /** Read-only: list SearchTasks for current organization. */
  async listSearchTasks(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, '请先登录', 'UNAUTHORIZED');
      }
      if (!req.org?.organizationId) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }

      const parsed = searchTaskListQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) {
        throw new AppError(400, 'page/pageSize 参数无效', 'BAD_REQUEST');
      }

      const data = await leadPoolService.listSearchTasks({
        organizationId: req.org.organizationId,
        query: parsed.data,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  /** Read-only: companies discovered for a SearchTask (with scores / contacts / source summary). */
  async getSearchTaskResults(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, '请先登录', 'UNAUTHORIZED');
      }
      if (!req.org?.organizationId) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }

      const taskId = String(req.params.taskId || '').trim();
      if (!taskId) {
        throw new AppError(400, 'taskId 必填', 'BAD_REQUEST');
      }

      const parsed = searchTaskResultsQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) {
        throw new AppError(400, 'results 查询参数无效', 'BAD_REQUEST');
      }

      const data = await leadPoolService.getSearchTaskResults({
        organizationId: req.org.organizationId,
        searchTaskId: taskId,
        query: parsed.data,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  /** Read-only: company detail within current organization. */
  async getCompanyDetail(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, '请先登录', 'UNAUTHORIZED');
      }
      if (!req.org?.organizationId) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }

      const companyId = String(req.params.companyId || '').trim();
      if (!companyId) {
        throw new AppError(400, 'companyId 必填', 'BAD_REQUEST');
      }

      const data = await leadPoolService.getCompanyDetail({
        organizationId: req.org.organizationId,
        companyId,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
