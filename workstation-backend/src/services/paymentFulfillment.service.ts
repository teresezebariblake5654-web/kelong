import { Plan, PlanType, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { WebhookResult } from '../providers/payment';

function addBillingPeriod(start: Date, billingCycle: string): Date {
  const end = new Date(start);
  const cycle = billingCycle.toUpperCase();
  if (cycle.includes('YEAR')) {
    end.setFullYear(end.getFullYear() + 1);
    return end;
  }
  end.setMonth(end.getMonth() + 1);
  return end;
}

async function creditWalletInTx(
  tx: Prisma.TransactionClient,
  input: {
    licenseId: string;
    amount: number;
    type: 'PURCHASE' | 'SUBSCRIPTION_GRANT';
    orderId: string;
    idempotencyKey: string;
    description: string;
  },
) {
  const existing = await tx.creditTransaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    return { balanceAfter: existing.balanceAfter, idempotent: true as const };
  }

  const wallet = await tx.creditWallet.findUnique({ where: { licenseId: input.licenseId } });
  if (!wallet) {
    throw new AppError(404, 'License 额度账户不存在', 'WALLET_NOT_FOUND');
  }

  const balanceAfter = wallet.balance + input.amount;
  const updated = await tx.creditWallet.updateMany({
    where: { id: wallet.id, version: wallet.version },
    data: {
      balance: { increment: input.amount },
      totalPurchased: input.type === 'PURCHASE' ? { increment: input.amount } : undefined,
      totalGranted: input.type === 'SUBSCRIPTION_GRANT' ? { increment: input.amount } : undefined,
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new AppError(409, '额度账户发生并发更新', 'WALLET_VERSION_CONFLICT');
  }

  await tx.creditTransaction.create({
    data: {
      licenseId: input.licenseId,
      orderId: input.orderId,
      type: input.type,
      amount: input.amount,
      balanceBefore: wallet.balance,
      balanceAfter,
      reason: input.description,
      description: input.description,
      idempotencyKey: input.idempotencyKey,
    },
  });

  return { balanceAfter, idempotent: false as const };
}

async function applyPlanBenefits(
  tx: Prisma.TransactionClient,
  order: { id: string; licenseId: string; orderNo: string },
  plan: Plan,
) {
  if (plan.includedCredits > 0) {
    const type =
      plan.type === 'PRO_MONTHLY' || plan.type === 'PRO_YEARLY'
        ? 'SUBSCRIPTION_GRANT'
        : 'PURCHASE';
    await creditWalletInTx(tx, {
      licenseId: order.licenseId,
      amount: plan.includedCredits,
      type,
      orderId: order.id,
      idempotencyKey: `order:${order.orderNo}:credit`,
      description:
        type === 'PURCHASE'
          ? `购买套餐额度：${plan.code}`
          : `订阅发放额度：${plan.code}`,
    });
  }

  if (plan.type === 'PRO_MONTHLY' || plan.type === 'PRO_YEARLY') {
    const now = new Date();
    const periodEnd = addBillingPeriod(now, plan.billingCycle || plan.type);
    await tx.subscription.create({
      data: {
        licenseId: order.licenseId,
        planId: plan.id,
        status: 'ACTIVE',
        startedAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
    });
    await tx.license.update({
      where: { id: order.licenseId },
      data: { planId: plan.id },
    });
  }
}

export const paymentFulfillmentService = {
  async fulfillPaidWebhook(provider: string, webhook: WebhookResult) {
    try {
      return await prisma.$transaction(async (tx) => {
        const duplicatedByEvent = await tx.paymentTransaction.findUnique({
          where: { webhookEventId: webhook.webhookEventId },
        });
        if (duplicatedByEvent) {
          const order = await tx.order.findUniqueOrThrow({
            where: { id: duplicatedByEvent.orderId },
          });
          return { order, paymentTransaction: duplicatedByEvent, idempotent: true };
        }

        const duplicatedByProviderTxn = await tx.paymentTransaction.findUnique({
          where: { providerTransactionId: webhook.providerTransactionId },
        });
        if (duplicatedByProviderTxn) {
          const order = await tx.order.findUniqueOrThrow({
            where: { id: duplicatedByProviderTxn.orderId },
          });
          return { order, paymentTransaction: duplicatedByProviderTxn, idempotent: true };
        }

        const order = await tx.order.findUnique({
          where: { orderNo: webhook.orderNo },
        });
        if (!order) {
          throw new AppError(404, '订单不存在', 'ORDER_NOT_FOUND');
        }
        if (order.amountCents !== webhook.amountCents) {
          throw new AppError(409, '支付金额与订单不一致', 'PAYMENT_AMOUNT_MISMATCH');
        }
        if (order.status === 'PAID') {
          return { order, paymentTransaction: null, idempotent: true };
        }
        if (order.status !== 'PENDING') {
          throw new AppError(409, `订单状态不可支付: ${order.status}`, 'ORDER_NOT_PAYABLE');
        }

        const plan = await tx.plan.findUnique({ where: { id: order.productId } });
        if (!plan || plan.status !== 'ACTIVE') {
          throw new AppError(404, '套餐不存在或已下架', 'PLAN_NOT_FOUND');
        }

        const paidAt = webhook.paidAt ?? new Date();
        const updated = await tx.order.updateMany({
          where: { id: order.id, status: 'PENDING' },
          data: { status: 'PAID', paidAt },
        });
        if (updated.count !== 1) {
          throw new AppError(409, '订单状态已变化', 'ORDER_STATE_CHANGED');
        }

        const paymentTransaction = await tx.paymentTransaction.create({
          data: {
            orderId: order.id,
            provider,
            providerTransactionId: webhook.providerTransactionId,
            webhookEventId: webhook.webhookEventId,
            amountCents: webhook.amountCents,
            status: 'PAID',
            rawPayloadHash: webhook.rawPayloadHash,
          },
        });

        await applyPlanBenefits(tx, order, plan);

        const paidOrder = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        return { order: paidOrder, paymentTransaction, idempotent: false };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing =
          (await prisma.paymentTransaction.findUnique({
            where: { webhookEventId: webhook.webhookEventId },
          })) ||
          (await prisma.paymentTransaction.findUnique({
            where: { providerTransactionId: webhook.providerTransactionId },
          }));
        if (existing) {
          const order = await prisma.order.findUniqueOrThrow({
            where: { id: existing.orderId },
          });
          return { order, paymentTransaction: existing, idempotent: true };
        }
      }
      throw error;
    }
  },
};

export function isSubscriptionPlan(type: PlanType): boolean {
  return type === 'PRO_MONTHLY' || type === 'PRO_YEARLY';
}
