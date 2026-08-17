import { CreditLedgerType, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { RechargeOrderStatus } from './rechargeOrder.service';

export const RechargeLedgerSource = {
  type: 'RECHARGE_ORDER',
} as const;

function creditAmountToInt(value: Prisma.Decimal | number): number {
  const n = typeof value === 'number' ? value : Number(value.toString());
  if (!Number.isFinite(n) || n <= 0) {
    throw new AppError(400, '订单额度无效', 'INVALID_CREDIT_AMOUNT');
  }
  const rounded = Math.round(n);
  if (rounded <= 0) {
    throw new AppError(400, '订单额度无效', 'INVALID_CREDIT_AMOUNT');
  }
  return rounded;
}

export type ConfirmRechargeResult = {
  orderId: string;
  orderNo: string;
  status: string;
  organizationId: string;
  creditedAmount: number;
  balanceBefore: number;
  balanceAfter: number;
  idempotent: boolean;
};

async function resolveOrganizationId(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<string> {
  const membership = await tx.organizationMember.findFirst({
    where: { userId, status: 'active' },
    orderBy: { createdAt: 'asc' },
    select: { organizationId: true },
  });
  if (membership) return membership.organizationId;

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { username: true },
  });
  const slugBase =
    (user?.username ?? 'user')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'org';

  const org = await tx.organization.create({
    data: {
      name: `${user?.username ?? 'user'} Org`,
      slug: `${slugBase}-${userId.slice(-8)}`,
      status: 'active',
      plan: 'free',
    },
  });
  await tx.organizationMember.create({
    data: {
      organizationId: org.id,
      userId,
      role: 'owner',
      status: 'active',
    },
  });
  return org.id;
}

type FulfillInput = {
  orderId: string;
  actorUserId: string;
  /** Statuses from which fulfillment is allowed (before PAID). */
  allowedFromStatuses: string[];
  adminRemark?: string;
  payerRemark?: string;
  /** When true, stamp userSubmittedAt (user self-serve mark-paid). */
  setUserSubmitted?: boolean;
  invalidStatusMessage?: string;
};

/**
 * Credit the org account for a recharge order and mark it PAID.
 * Fully transactional + idempotent via CreditLedger (sourceType, sourceId).
 */
export async function fulfillRechargeOrder(
  input: FulfillInput,
): Promise<ConfirmRechargeResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT id FROM "RechargeOrder" WHERE id = ${input.orderId} FOR UPDATE
    `;

    const order = await tx.rechargeOrder.findUnique({
      where: { id: input.orderId },
    });
    if (!order) {
      throw new AppError(404, '订单不存在', 'RECHARGE_ORDER_NOT_FOUND');
    }

    const creditAmount = creditAmountToInt(order.creditAmount);
    const organizationId = await resolveOrganizationId(tx, order.userId);

    if (order.status === RechargeOrderStatus.Paid) {
      const account = await tx.creditAccount.findUnique({
        where: { organizationId },
      });
      const balance = account?.balance ?? 0;
      return {
        orderId: order.id,
        orderNo: order.orderNo,
        status: order.status,
        organizationId,
        creditedAmount: creditAmount,
        balanceBefore: balance,
        balanceAfter: balance,
        idempotent: true,
      };
    }

    if (!input.allowedFromStatuses.includes(order.status)) {
      throw new AppError(
        409,
        input.invalidStatusMessage ?? '当前订单状态不可入账',
        'INVALID_ORDER_STATUS',
      );
    }

    const existingLedger = await tx.creditLedger.findFirst({
      where: {
        sourceType: RechargeLedgerSource.type,
        sourceId: order.id,
      },
    });
    if (existingLedger) {
      await tx.rechargeOrder.update({
        where: { id: order.id },
        data: {
          status: RechargeOrderStatus.Paid,
          reviewedByAdminId: input.actorUserId,
          reviewedAt: new Date(),
          ...(input.setUserSubmitted ? { userSubmittedAt: new Date() } : {}),
          ...(input.payerRemark?.trim()
            ? { payerRemark: input.payerRemark.trim() }
            : {}),
          ...(input.adminRemark?.trim()
            ? { adminRemark: input.adminRemark.trim() }
            : {}),
        },
      });
      return {
        orderId: order.id,
        orderNo: order.orderNo,
        status: RechargeOrderStatus.Paid,
        organizationId,
        creditedAmount: creditAmount,
        balanceBefore: existingLedger.balanceBefore,
        balanceAfter: existingLedger.balanceAfter,
        idempotent: true,
      };
    }

    let account = await tx.creditAccount.findUnique({
      where: { organizationId },
    });
    if (account) {
      await tx.$executeRaw`
        SELECT id FROM "CreditAccount" WHERE id = ${account.id} FOR UPDATE
      `;
      account = await tx.creditAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
    } else {
      try {
        account = await tx.creditAccount.create({
          data: {
            organizationId,
            balance: 0,
            frozenBalance: 0,
            totalRecharged: 0,
            totalConsumed: 0,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          account = await tx.creditAccount.findUniqueOrThrow({
            where: { organizationId },
          });
          await tx.$executeRaw`
            SELECT id FROM "CreditAccount" WHERE id = ${account.id} FOR UPDATE
          `;
          account = await tx.creditAccount.findUniqueOrThrow({
            where: { id: account.id },
          });
        } else {
          throw error;
        }
      }
    }

    const balanceBefore = account.balance;
    const balanceAfter = balanceBefore + creditAmount;

    await tx.creditAccount.update({
      where: { id: account.id },
      data: {
        balance: balanceAfter,
        totalRecharged: { increment: creditAmount },
      },
    });

    await tx.creditLedger.create({
      data: {
        organizationId,
        userId: order.userId,
        type: CreditLedgerType.RECHARGE,
        amount: creditAmount,
        balanceBefore,
        balanceAfter,
        description: `积分充值到账 ${order.orderNo}（${order.planNameSnapshot}）`,
        idempotencyKey: `recharge_order:${order.id}`,
        sourceType: RechargeLedgerSource.type,
        sourceId: order.id,
      },
    });

    await tx.rechargeOrder.update({
      where: { id: order.id },
      data: {
        status: RechargeOrderStatus.Paid,
        reviewedByAdminId: input.actorUserId,
        reviewedAt: new Date(),
        ...(input.setUserSubmitted ? { userSubmittedAt: new Date() } : {}),
        ...(input.payerRemark?.trim()
          ? { payerRemark: input.payerRemark.trim() }
          : {}),
        ...(input.adminRemark?.trim()
          ? { adminRemark: input.adminRemark.trim() }
          : {}),
      },
    });

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      status: RechargeOrderStatus.Paid,
      organizationId,
      creditedAmount: creditAmount,
      balanceBefore,
      balanceAfter,
      idempotent: false,
    };
  });
}

/**
 * Admin confirms a PENDING_REVIEW recharge order (legacy path) and credits the account.
 */
export async function confirmRechargeOrder(input: {
  orderId: string;
  adminUserId: string;
  adminRemark?: string;
}): Promise<ConfirmRechargeResult> {
  return fulfillRechargeOrder({
    orderId: input.orderId,
    actorUserId: input.adminUserId,
    allowedFromStatuses: [RechargeOrderStatus.PendingReview],
    adminRemark: input.adminRemark,
    invalidStatusMessage: '仅待审核订单可确认入账',
  });
}

export const rechargeConfirmService = {
  confirmRechargeOrder,
  fulfillRechargeOrder,
};
