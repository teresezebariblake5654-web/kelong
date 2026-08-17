import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { billingService } from '../services/billing.service';
import { usageService } from '../services/usage.service';
import { AppError } from '../utils/errors';

export const adminController = {
  async listUsers(_req: Request, res: Response, next: NextFunction) {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          credits: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ success: true, data: users });
    } catch (error) {
      next(error);
    }
  },

  async addCredits(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = String(req.params.userId);
      const amount = Number(req.body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new AppError(400, '发放积分必须大于 0', 'BAD_REQUEST');
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new AppError(404, '用户不存在', 'NOT_FOUND');
      }

      const credits = await billingService.addCredits(userId, amount, 'admin_grant');
      res.json({ success: true, data: { userId, credits } });
    } catch (error) {
      next(error);
    }
  },

  async usage(_req: Request, res: Response, next: NextFunction) {
    try {
      const records = await usageService.listAll();
      res.json({ success: true, data: records });
    } catch (error) {
      next(error);
    }
  },
};
