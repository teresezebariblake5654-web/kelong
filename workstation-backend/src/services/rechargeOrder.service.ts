import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';

/** Manual recharge order statuses. */
export const RechargeOrderStatus = {
  PendingPayment: 'PENDING_PAYMENT',
  PendingReview: 'PENDING_REVIEW',
  Cancelled: 'CANCELLED',
  Paid: 'PAID',
} as const;

export type RechargeOrderStatusValue =
  (typeof RechargeOrderStatus)[keyof typeof RechargeOrderStatus];

export type RechargeOrderPublic = {
  id: string;
  orderNo: string;
  userId: string;
  planId: string | null;
  planNameSnapshot: string;
  amountCents: number;
  creditAmount: number;
  paymentMethod: string;
  status: string;
  payerRemark: string | null;
  adminRemark: string | null;
  userSubmittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function decimalToNumber(value: Prisma.Decimal | number): number {
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

function toPublic(order: {
  id: string;
  orderNo: string;
  userId: string;
  planId: string | null;
  planNameSnapshot: string;
  amountCents: number;
  creditAmount: Prisma.Decimal;
  paymentMethod: string;
  status: string;
  payerRemark: string | null;
  adminRemark: string | null;
  userSubmittedAt: Date | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): RechargeOrderPublic {
  return {
    id: order.id,
    orderNo: order.orderNo,
    userId: order.userId,
    planId: order.planId,
    planNameSnapshot: order.planNameSnapshot,
    amountCents: order.amountCents,
    creditAmount: decimalToNumber(order.creditAmount),
    paymentMethod: order.paymentMethod,
    status: order.status,
    payerRemark: order.payerRemark,
    adminRemark: order.adminRemark,
    userSubmittedAt: order.userSubmittedAt?.toISOString() ?? null,
    reviewedAt: order.reviewedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

/** RC + yyyymmddHHMMSS + 8 hex chars, e.g. RC20260730143022A1B2C3D4 */
export function generateRechargeOrderNo(now = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `RC${stamp}${suffix}`;
}

export const rechargeOrderService = {
  async createOrder(input: {
    userId: string;
    planId: string;
    paymentMethod?: string;
    payerRemark?: string;
  }): Promise<RechargeOrderPublic> {
    const plan = await prisma.rechargePlan.findFirst({
      where: { id: input.planId, enabled: true },
    });
    if (!plan) {
      throw new AppError(404, '充值套餐不存在或已下架', 'RECHARGE_PLAN_NOT_FOUND');
    }

    const paymentMethod = (input.paymentMethod ?? 'manual').trim() || 'manual';
    const payerRemark = input.payerRemark?.trim() || null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const orderNo = generateRechargeOrderNo();
      try {
        const order = await prisma.rechargeOrder.create({
          data: {
            orderNo,
            userId: input.userId,
            planId: plan.id,
            planNameSnapshot: plan.name,
            amountCents: plan.priceCents,
            creditAmount: plan.creditAmount,
            paymentMethod,
            status: RechargeOrderStatus.PendingPayment,
            payerRemark,
          },
        });
        return toPublic(order);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new AppError(500, '生成订单号失败，请重试', 'ORDER_NO_GENERATE_FAILED');
  },

  async listOrders(userId: string): Promise<RechargeOrderPublic[]> {
    const orders = await prisma.rechargeOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map(toPublic);
  },

  async getOrder(userId: string, orderId: string): Promise<RechargeOrderPublic> {
    const order = await prisma.rechargeOrder.findFirst({
      where: { id: orderId, userId },
    });
    if (!order) {
      throw new AppError(404, '订单不存在', 'RECHARGE_ORDER_NOT_FOUND');
    }
    return toPublic(order);
  },

  /** User declares payment done → credits land immediately (no admin review). */
  async markPaid(
    userId: string,
    orderId: string,
    options: { payerRemark?: string } = {},
  ): Promise<RechargeOrderPublic> {
    const order = await prisma.rechargeOrder.findFirst({
      where: { id: orderId, userId },
    });
    if (!order) {
      throw new AppError(404, '订单不存在', 'RECHARGE_ORDER_NOT_FOUND');
    }
    if (order.status === RechargeOrderStatus.Paid) {
      return toPublic(order);
    }
    if (order.status !== RechargeOrderStatus.PendingPayment) {
      throw new AppError(409, '当前订单状态不可标记已付款', 'INVALID_ORDER_STATUS');
    }

    const { fulfillRechargeOrder } = await import('./rechargeConfirm.service');
    await fulfillRechargeOrder({
      orderId: order.id,
      actorUserId: userId,
      allowedFromStatuses: [RechargeOrderStatus.PendingPayment],
      payerRemark: options.payerRemark,
      setUserSubmitted: true,
      adminRemark: 'auto_on_mark_paid',
      invalidStatusMessage: '当前订单状态不可标记已付款',
    });

    return this.getOrder(userId, orderId);
  },

  async cancel(userId: string, orderId: string): Promise<RechargeOrderPublic> {
    const order = await prisma.rechargeOrder.findFirst({
      where: { id: orderId, userId },
    });
    if (!order) {
      throw new AppError(404, '订单不存在', 'RECHARGE_ORDER_NOT_FOUND');
    }
    if (order.status !== RechargeOrderStatus.PendingPayment) {
      throw new AppError(409, '仅待付款订单可取消', 'INVALID_ORDER_STATUS');
    }

    const updated = await prisma.rechargeOrder.update({
      where: { id: order.id },
      data: { status: RechargeOrderStatus.Cancelled },
    });
    return toPublic(updated);
  },
};
