import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { rechargeConfirmService } from '../services/rechargeConfirm.service';
import { AppError } from '../utils/errors';

const confirmSchema = z
  .object({
    adminRemark: z.string().trim().max(500).optional(),
  })
  .strict();

export const adminRechargeController = {
  async confirmOrder(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, '请先登录', 'UNAUTHORIZED');
      }
      const orderId = String(req.params.id ?? '').trim();
      if (!orderId) {
        throw new AppError(400, '缺少订单 id', 'BAD_REQUEST');
      }
      const parsed = confirmSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError(400, '确认参数无效', 'INVALID_CONFIRM');
      }

      const data = await rechargeConfirmService.confirmRechargeOrder({
        orderId,
        adminUserId: req.user.id,
        adminRemark: parsed.data.adminRemark,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
