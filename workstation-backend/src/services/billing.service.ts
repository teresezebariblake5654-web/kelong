import { randomUUID } from 'crypto';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';

export const billingService = {
  async getUserCredits(userId: string): Promise<number> {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new AppError(404, '用户不存在', 'NOT_FOUND');
    }

    return user.credits;
  },

  async checkCredits(userId: string, amount: number): Promise<void> {
    if (amount <= 0) {
      throw new AppError(400, '校验金额必须大于 0', 'BAD_REQUEST');
    }

    const credits = await this.getUserCredits(userId);

    if (credits < amount) {
      throw new AppError(
        402,
        `AI 积分不足，请购买积分后继续使用。（当前 ${credits}，需要 ${amount}）`,
        'INSUFFICIENT_CREDITS',
      );
    }
  },

  async consumeCredits(
    userId: string,
    amount: number,
    reason: string,
    relatedReportId?: string,
    organizationId?: string,
  ): Promise<{ balanceBefore: number; balanceAfter: number }> {
    if (amount <= 0) {
      throw new AppError(400, '扣费金额必须大于 0', 'BAD_REQUEST');
    }

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });

      if (!user) {
        throw new AppError(404, '用户不存在', 'NOT_FOUND');
      }

      const balanceBefore = user.credits;

      if (balanceBefore < amount) {
        throw new AppError(
          402,
          `AI 积分不足，请购买积分后继续使用。（当前 ${balanceBefore}，需要 ${amount}）`,
          'INSUFFICIENT_CREDITS',
        );
      }

      const balanceAfter = balanceBefore - amount;

      await tx.user.update({
        where: { id: userId },
        data: { credits: balanceAfter },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          organizationId,
          type: 'CONSUME',
          amount,
          balanceBefore,
          balanceAfter,
          reason,
          description: reason,
          idempotencyKey: `legacy-user-consume:${randomUUID()}`,
          relatedReportId,
        },
      });

      return { balanceBefore, balanceAfter };
    });
  },

  async addCredits(
    userId: string,
    amount: number,
    reason: string,
    organizationId?: string,
  ): Promise<number> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError(400, '充值额度必须大于 0', 'BAD_REQUEST');
    }

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });

      if (!user) {
        throw new AppError(404, '用户不存在', 'NOT_FOUND');
      }

      const balanceBefore = user.credits;
      const balanceAfter = balanceBefore + Math.floor(amount);

      await tx.user.update({
        where: { id: userId },
        data: { credits: balanceAfter },
      });

      await tx.creditTransaction.create({
        data: {
          userId,
          organizationId,
          type: 'ADMIN_ADJUSTMENT',
          amount: Math.floor(amount),
          balanceBefore,
          balanceAfter,
          reason,
          description: reason,
          idempotencyKey: `legacy-user-grant:${randomUUID()}`,
        },
      });

      return balanceAfter;
    });
  },
};
