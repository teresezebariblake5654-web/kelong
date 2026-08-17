import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { billingService } from '../services/billing.service';
import { usageService } from '../services/usage.service';
import { AppError } from '../utils/errors';

export const billingController = {
  async credits(req: Request, res: Response, next: NextFunction) {
    try {
      const credits = await billingService.getUserCredits(req.user!.id);
      res.json({ success: true, data: { credits } });
    } catch (error) {
      next(error);
    }
  },

  async usage(req: Request, res: Response, next: NextFunction) {
    try {
      const records = await usageService.getUserLogs(req.user!.id);
      res.json({ success: true, data: records });
    } catch (error) {
      next(error);
    }
  },

  /** Dev-only mock recharge; disabled in production (route may be remounted later). */
  async mockRecharge(req: Request, res: Response, next: NextFunction) {
    try {
      if (env.isProduction || process.env.NODE_ENV === 'production') {
        throw new AppError(404, '接口不存在', 'NOT_FOUND');
      }
      const amount = Number(req.body.amount ?? 100);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new AppError(400, '购买积分数量必须大于 0', 'BAD_REQUEST');
      }

      const credits = await billingService.addCredits(
        req.user!.id,
        amount,
        'mock_recharge_v1',
      );
      res.json({
        success: true,
        data: { credits, message: '模拟充值成功（第一版无真实支付）' },
      });
    } catch (error) {
      next(error);
    }
  },
};
