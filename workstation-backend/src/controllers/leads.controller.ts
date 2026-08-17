import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { leadDiscoveryService } from '../services/leads/lead-discovery.service';
import { AppError } from '../utils/errors';

const discoveryPreviewSchema = z
  .object({
    query: z.string().trim().min(2).max(500),
    maxCandidates: z.coerce.number().int().min(1).max(5).optional(),
  })
  .strict();

export const leadsController = {
  async discoveryPreview(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, '请先登录', 'UNAUTHORIZED');
      }
      if (!req.org?.organizationId) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }

      const parsed = discoveryPreviewSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError(400, 'query 必填；maxCandidates 可选 1-5', 'BAD_REQUEST');
      }

      const data = await leadDiscoveryService.runDiscoveryPreview(parsed.data);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
