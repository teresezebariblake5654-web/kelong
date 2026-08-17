import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { rechargeOrderService } from '../services/rechargeOrder.service';
import { rechargePlanService } from '../services/rechargePlan.service';
import { getRechargeSettings } from '../services/rechargeSettings.service';
import { AppError } from '../utils/errors';

const createOrderSchema = z
  .object({
    planId: z.string().trim().min(1).max(64),
    paymentMethod: z.string().trim().min(1).max(64).optional(),
    payerRemark: z.string().trim().max(500).optional(),
  })
  .strict();

const markPaidSchema = z
  .object({
    payerRemark: z.string().trim().max(500).optional(),
  })
  .strict();

function requireUser(req: Request) {
  if (!req.user) {
    throw new AppError(401, '请先登录', 'UNAUTHORIZED');
  }
  return req.user;
}

export const rechargeController = {
  async listPlans(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await rechargePlanService.listEnabledPlans();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  /** Phase 7: QR / payee copy from env (public read). */
  async getSettings(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: getRechargeSettings() });
    } catch (error) {
      next(error);
    }
  },

  async createOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const parsed = createOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, '创建订单参数无效', 'INVALID_RECHARGE_ORDER');
      }
      const data = await rechargeOrderService.createOrder({
        userId: user.id,
        planId: parsed.data.planId,
        paymentMethod: parsed.data.paymentMethod,
        payerRemark: parsed.data.payerRemark,
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const data = await rechargeOrderService.listOrders(user.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const orderId = String(req.params.id ?? '').trim();
      if (!orderId) {
        throw new AppError(400, '缺少订单 id', 'BAD_REQUEST');
      }
      const data = await rechargeOrderService.getOrder(user.id, orderId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async markPaid(req: Request, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const orderId = String(req.params.id ?? '').trim();
      if (!orderId) {
        throw new AppError(400, '缺少订单 id', 'BAD_REQUEST');
      }
      const parsed = markPaidSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError(400, '标记付款参数无效', 'INVALID_MARK_PAID');
      }
      const data = await rechargeOrderService.markPaid(user.id, orderId, {
        payerRemark: parsed.data.payerRemark,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const orderId = String(req.params.id ?? '').trim();
      if (!orderId) {
        throw new AppError(400, '缺少订单 id', 'BAD_REQUEST');
      }
      const data = await rechargeOrderService.cancel(user.id, orderId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
