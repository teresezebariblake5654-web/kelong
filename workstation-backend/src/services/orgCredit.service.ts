import { CreditLedgerType, Prisma } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';

export const SIGNUP_BONUS_SOURCE_TYPE = 'BONUS';

export type EnsureCreditAccountOptions = {
  /**
   * Only applied when the account is first created.
   * Omit to grant SIGNUP_BONUS_CREDITS (idempotent BONUS ledger).
   * Pass 0 (or any number) to skip the default signup bonus path.
   */
  initialBalance?: number;
  userId?: string;
  description?: string;
};

export type OrgCreditMutationInput = {
  organizationId: string;
  userId?: string;
  taskId?: string;
  amount: number;
  idempotencyKey: string;
  description: string;
};

export type OrgSettleInput = {
  organizationId: string;
  userId?: string;
  taskId?: string;
  reservedAmount: number;
  chargedAmount: number;
  idempotencyKey: string;
  description: string;
};

function positiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(400, `${field} 必须为正整数`, 'INVALID_CREDIT_AMOUNT');
  }
}

export const orgCreditService = {
  async ensureAccount(
    organizationId: string,
    options: EnsureCreditAccountOptions = {},
  ) {
    const existing = await prisma.creditAccount.findUnique({
      where: { organizationId },
    });
    if (existing) return existing;

    const useSignupBonus = options.initialBalance === undefined;
    const initialBalance = Math.max(
      0,
      useSignupBonus ? env.signupBonusCredits : (options.initialBalance ?? 0),
    );

    try {
      const created = await prisma.$transaction(async (tx) => {
        const account = await tx.creditAccount.create({
          data: {
            organizationId,
            balance: initialBalance,
            frozenBalance: 0,
            totalRecharged: 0,
            totalConsumed: 0,
          },
        });

        if (initialBalance > 0) {
          await tx.creditLedger.create({
            data: {
              organizationId,
              userId: options.userId,
              type: CreditLedgerType.INITIAL,
              amount: initialBalance,
              balanceBefore: 0,
              balanceAfter: initialBalance,
              description: useSignupBonus
                ? `新用户赠送积分 BONUS credits=${initialBalance}`
                : (options.description ?? '组织初始 AI 积分'),
              idempotencyKey: useSignupBonus
                ? `org:${organizationId}:signup_bonus`
                : `org:${organizationId}:initial`,
              sourceType: useSignupBonus ? SIGNUP_BONUS_SOURCE_TYPE : 'INITIAL',
              sourceId: useSignupBonus
                ? `signup:${organizationId}`
                : `initial:${organizationId}`,
            },
          });
        }

        return account;
      });
      return created;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await prisma.creditAccount.findUnique({
          where: { organizationId },
        });
        if (raced) return raced;
      }
      throw error;
    }
  },

  async getBalance(organizationId: string) {
    const account = await this.ensureAccount(organizationId);
    return {
      balance: account.balance,
      frozenBalance: account.frozenBalance,
      availableBalance: Math.max(0, account.balance - account.frozenBalance),
      unit: 'credits' as const,
      updatedAt: account.updatedAt.toISOString(),
    };
  },

  /** Read-only sum of CONSUME ledger amounts since `since` (Phase 7 monthly display). */
  async sumConsumedSince(organizationId: string, since: Date): Promise<number> {
    const result = await prisma.creditLedger.aggregate({
      where: {
        organizationId,
        type: CreditLedgerType.CONSUME,
        createdAt: { gte: since },
        amount: { gt: 0 },
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  },

  /** Freeze credits before AI call (idempotent). */
  async reserve(input: OrgCreditMutationInput) {
    positiveInteger(input.amount, 'amount');
    const existing = await prisma.creditLedger.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      const account = await this.ensureAccount(input.organizationId);
      return { balance: account.balance, frozenBalance: account.frozenBalance, idempotent: true };
    }

    return prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!account) {
        throw new AppError(404, '组织额度账户不存在', 'ORG_CREDIT_NOT_FOUND');
      }
      const available = account.balance - account.frozenBalance;
      if (available < input.amount) {
        throw new AppError(402, '组织分析额度不足', 'INSUFFICIENT_ORG_CREDITS');
      }
      const updated = await tx.creditAccount.update({
        where: { organizationId: input.organizationId },
        data: { frozenBalance: { increment: input.amount } },
      });
      await tx.creditLedger.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId,
          taskId: input.taskId,
          type: CreditLedgerType.CONSUME,
          amount: 0,
          balanceBefore: account.balance,
          balanceAfter: account.balance,
          description: `${input.description}（预留 ${input.amount}）`,
          idempotencyKey: input.idempotencyKey,
        },
      });
      return {
        balance: updated.balance,
        frozenBalance: updated.frozenBalance,
        idempotent: false,
      };
    });
  },

  /** Settle reserved credits after success (charge subset, release rest). */
  async settle(input: OrgSettleInput) {
    if (!Number.isInteger(input.reservedAmount) || input.reservedAmount < 0) {
      throw new AppError(400, 'reservedAmount 无效', 'INVALID_CREDIT_AMOUNT');
    }
    if (
      !Number.isInteger(input.chargedAmount) ||
      input.chargedAmount < 0 ||
      input.chargedAmount > input.reservedAmount
    ) {
      throw new AppError(400, 'chargedAmount 无效', 'INVALID_CREDIT_AMOUNT');
    }

    const consumeKey = `${input.idempotencyKey}:consume`;
    const existing = await prisma.creditLedger.findFirst({
      where: { idempotencyKey: { in: [consumeKey, `${input.idempotencyKey}:release`] } },
    });
    if (existing) {
      const account = await this.ensureAccount(input.organizationId);
      return { balance: account.balance, charged: input.chargedAmount, idempotent: true };
    }

    return prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!account) {
        throw new AppError(404, '组织额度账户不存在', 'ORG_CREDIT_NOT_FOUND');
      }
      if (account.frozenBalance < input.reservedAmount) {
        throw new AppError(409, '预留额度不足', 'INSUFFICIENT_RESERVED_CREDITS');
      }

      const released = input.reservedAmount - input.chargedAmount;
      const balanceAfter = account.balance - input.chargedAmount;
      const updated = await tx.creditAccount.update({
        where: { organizationId: input.organizationId },
        data: {
          balance: { decrement: input.chargedAmount },
          frozenBalance: { decrement: input.reservedAmount },
        },
      });

      if (input.chargedAmount > 0) {
        await tx.creditLedger.create({
          data: {
            organizationId: input.organizationId,
            userId: input.userId,
            taskId: input.taskId,
            type: CreditLedgerType.CONSUME,
            amount: input.chargedAmount,
            balanceBefore: account.balance,
            balanceAfter,
            description: input.description,
            idempotencyKey: consumeKey,
          },
        });
      } else {
        await tx.creditLedger.create({
          data: {
            organizationId: input.organizationId,
            userId: input.userId,
            taskId: input.taskId,
            type: CreditLedgerType.REFUND,
            amount: released,
            balanceBefore: account.balance,
            balanceAfter: account.balance,
            description: `${input.description}（全部释放）`,
            idempotencyKey: `${input.idempotencyKey}:release`,
          },
        });
      }

      if (input.chargedAmount > 0 && released > 0) {
        await tx.creditLedger.create({
          data: {
            organizationId: input.organizationId,
            userId: input.userId,
            taskId: input.taskId,
            type: CreditLedgerType.REFUND,
            amount: released,
            balanceBefore: balanceAfter,
            balanceAfter,
            description: `${input.description}（释放未用 ${released}）`,
            idempotencyKey: `${input.idempotencyKey}:partial-release`,
          },
        });
      }

      return { balance: updated.balance, charged: input.chargedAmount, idempotent: false };
    });
  },

  /** Release reserved credits on failure. */
  async release(input: OrgCreditMutationInput) {
    positiveInteger(input.amount, 'amount');
    const existing = await prisma.creditLedger.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      const account = await this.ensureAccount(input.organizationId);
      return { balance: account.balance, frozenBalance: account.frozenBalance, idempotent: true };
    }

    return prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUnique({
        where: { organizationId: input.organizationId },
      });
      if (!account) {
        throw new AppError(404, '组织额度账户不存在', 'ORG_CREDIT_NOT_FOUND');
      }
      if (account.frozenBalance < input.amount) {
        throw new AppError(409, '预留额度不足', 'INSUFFICIENT_RESERVED_CREDITS');
      }
      const updated = await tx.creditAccount.update({
        where: { organizationId: input.organizationId },
        data: { frozenBalance: { decrement: input.amount } },
      });
      await tx.creditLedger.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId,
          taskId: input.taskId,
          type: CreditLedgerType.REFUND,
          amount: input.amount,
          balanceBefore: account.balance,
          balanceAfter: account.balance,
          description: input.description,
          idempotencyKey: input.idempotencyKey,
        },
      });
      return {
        balance: updated.balance,
        frozenBalance: updated.frozenBalance,
        idempotent: false,
      };
    });
  },

  async listLedger(
    organizationId: string,
    input: { page?: number; pageSize?: number; typeFilter?: string } = {},
  ) {
    await this.ensureAccount(organizationId);
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
    const typeFilter = input.typeFilter?.trim().toUpperCase();

    const where: Prisma.CreditLedgerWhereInput = { organizationId };
    if (typeFilter === 'RECHARGE') {
      where.type = CreditLedgerType.RECHARGE;
    } else if (typeFilter === 'AI_CONSUME' || typeFilter === 'CONSUME') {
      where.OR = [
        { type: CreditLedgerType.CONSUME },
        { sourceType: 'AI_CONSUME' },
      ];
    } else if (typeFilter === 'REFUND') {
      where.type = CreditLedgerType.REFUND;
    } else if (typeFilter === 'ADMIN_ADJUST') {
      where.type = CreditLedgerType.ADMIN_ADJUST;
    } else if (typeFilter === 'BONUS') {
      where.sourceType = SIGNUP_BONUS_SOURCE_TYPE;
    } else if (typeFilter === 'INITIAL') {
      where.type = CreditLedgerType.INITIAL;
    }

    const [total, rows] = await Promise.all([
      prisma.creditLedger.count({ where }),
      prisma.creditLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        sourceType: row.sourceType,
        amount: row.amount,
        balanceBefore: row.balanceBefore,
        balanceAfter: row.balanceAfter,
        description: row.description,
        createdAt: row.createdAt.toISOString(),
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  },
};
