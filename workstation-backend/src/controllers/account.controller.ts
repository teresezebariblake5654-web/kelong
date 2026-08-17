import { Request, Response, NextFunction } from 'express';
import { organizationService } from '../services/organization.service';
import { AppError } from '../utils/errors';

export const accountController = {
  async profile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, '请先登录', 'UNAUTHORIZED');
      }
      if (!req.org?.organizationId) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }

      const org = await organizationService.getByIdForUser(
        req.user.id,
        req.org.organizationId,
      );

      const displayName = req.user.username?.trim() || null;

      res.json({
        success: true,
        data: {
          user: {
            id: req.user.id,
            displayName,
            email: req.user.email,
          },
          organization: {
            id: org.id,
            name: org.name,
            role: String(org.role || req.org.role || 'member').toUpperCase(),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
};
