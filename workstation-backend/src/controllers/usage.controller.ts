import { Request, Response, NextFunction } from 'express';
import { usageService } from '../services/usage.service';
import { AppError } from '../utils/errors';

export const usageController = {
  async getLogs(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.org) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }
      const logs = await usageService.listByOrganization(req.org.organizationId);
      res.json({ success: true, data: logs });
    } catch (error) {
      next(error);
    }
  },
};
