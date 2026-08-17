import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { orderService } from '../services/order.service';
import { AppError } from '../utils/errors';

const createOrderSchema = z
  .object({
    planCode: z.string().trim().min(1).max(100),
    paymentProvider: z.enum(['mock', 'wechat', 'alipay']).optional(),
  })
  .strict();

const mockCompleteSchema = z
  .object({
    orderNo: z.string().trim().min(1),
    signature: z.string().trim().min(1),
    providerTransactionId: z.string().trim().min(1).optional(),
    webhookEventId: z.string().trim().min(1).optional(),
  })
  .strict();

function license(req: Request) {
  if (!req.license) {
    throw new AppError(401, '缺少 License 授权上下文', 'LICENSE_TOKEN_REQUIRED');
  }
  return req.license;
}

export const paymentController = {
  async listPlans(_req: Request, res: Response, next: NextFunction) {
    try {
      const plans = await orderService.listActivePlans();
      res.json({ success: true, data: plans });
    } catch (error) {
      next(error);
    }
  },

  async createOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = createOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, '创建订单参数无效', 'INVALID_ORDER_REQUEST');
      }
      const auth = license(req);
      const result = await orderService.createOrder({
        licenseId: auth.licenseId,
        productType: auth.productType,
        planCode: parsed.data.planCode,
        paymentProvider: parsed.data.paymentProvider,
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async getOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const order = await orderService.getOrder(
        license(req).licenseId,
        String(req.params.orderNo),
      );
      res.json({ success: true, data: order });
    } catch (error) {
      next(error);
    }
  },

  async mockComplete(req: Request, res: Response, next: NextFunction) {
    try {
      if (env.isProduction || process.env.NODE_ENV === 'production') {
        throw new AppError(404, '接口不存在', 'NOT_FOUND');
      }
      const parsed = mockCompleteSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'Mock 支付完成参数无效', 'INVALID_MOCK_COMPLETE');
      }
      const result = await orderService.completeMockPayment(parsed.data);
      res.json({
        success: true,
        data: {
          orderNo: result.order.orderNo,
          status: result.order.status,
          paidAt: result.order.paidAt,
          idempotent: result.idempotent,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async wechatNotify(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await orderService.handleProviderWebhook(
        'wechat',
        req.body,
        req.headers,
      );
      res.json({
        code: 'SUCCESS',
        message: result.idempotent ? 'DUPLICATE' : 'OK',
      });
    } catch (error) {
      next(error);
    }
  },

  async alipayNotify(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await orderService.handleProviderWebhook(
        'alipay',
        req.body,
        req.headers,
      );
      res.send(result.idempotent ? 'success' : 'success');
    } catch (error) {
      next(error);
    }
  },
};
