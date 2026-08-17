import { CreditTransactionType, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { creditWalletService, WalletMutationInput } from './creditWallet.service';

type BaseCreditInput = Omit<WalletMutationInput, 'type'>;

export type SettleCreditsInput = {
  licenseId: string;
  usageId: string;
  reservedAmount: number;
  chargedAmount: number;
  idempotencyKey: string;
  description: string;
};

const GRANT_TYPES: CreditTransactionType[] = [
  'SUBSCRIPTION_GRANT',
  'ADMIN_ADJUSTMENT',
  'PROMOTION',
];

function positiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(400, `${field} 必须为正整数`, 'INVALID_CREDIT_AMOUNT');
  }
}

async function settleOnce(input: SettleCreditsInput) {
  const consumeKey = `${input.idempotencyKey}:consume`;
  const releaseKey = `${input.idempotencyKey}:release`;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.creditTransaction.findFirst({
      where: { idempotencyKey: { in: [consumeKey, releaseKey] } },
    });
    if (existing) {
      const wallet = await tx.creditWallet.findUniqueOrThrow({
        where: { licenseId: input.licenseId },
      });
      return { balance: wallet.balance, charged: input.chargedAmount, idempotent: true };
    }

    const wallet = await tx.creditWallet.findUnique({
      where: { licenseId: input.licenseId },
    });
    if (!wallet) {
      throw new AppError(404, 'License 额度账户不存在', 'WALLET_NOT_FOUND');
    }
    if (wallet.reservedBalance < input.reservedAmount) {
      throw new AppError(409, '预留额度不足', 'INSUFFICIENT_RESERVED_CREDITS');
    }

    const releasedAmount = input.reservedAmount - input.chargedAmount;
    const balanceAfter = wallet.balance + releasedAmount;
    const updated = await tx.creditWallet.updateMany({
      where: {
        id: wallet.id,
        version: wallet.version,
        reservedBalance: { gte: input.reservedAmount },
      },
      data: {
        balance: { increment: releasedAmount },
        reservedBalance: { decrement: input.reservedAmount },
        totalConsumed: { increment: input.chargedAmount },
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new AppError(409, '额度账户发生并发更新', 'WALLET_VERSION_CONFLICT');
    }

    if (input.chargedAmount > 0) {
      await tx.creditTransaction.create({
        data: {
          licenseId: input.licenseId,
          usageId: input.usageId,
          type: 'CONSUME',
          amount: input.chargedAmount,
          balanceBefore: wallet.balance,
          balanceAfter: wallet.balance,
          reason: input.description,
          description: input.description,
          idempotencyKey: consumeKey,
        },
      });
    }
    if (releasedAmount > 0) {
      await tx.creditTransaction.create({
        data: {
          licenseId: input.licenseId,
          usageId: input.usageId,
          type: 'RELEASE',
          amount: releasedAmount,
          balanceBefore: wallet.balance,
          balanceAfter,
          reason: `${input.description}：释放多余预留额度`,
          description: `${input.description}：释放多余预留额度`,
          idempotencyKey: releaseKey,
        },
      });
    }

    return { balance: balanceAfter, charged: input.chargedAmount, idempotent: false };
  });
}

export const creditService = {
  reserveCredits(input: BaseCreditInput) {
    return creditWalletService.reserve(input);
  },

  async settleCredits(input: SettleCreditsInput) {
    positiveInteger(input.reservedAmount, 'reservedAmount');
    if (
      !Number.isInteger(input.chargedAmount) ||
      input.chargedAmount < 0 ||
      input.chargedAmount > input.reservedAmount
    ) {
      throw new AppError(400, 'chargedAmount 必须在预留额度范围内', 'INVALID_SETTLEMENT');
    }
    try {
      return await settleOnce(input);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return settleOnce(input);
      }
      throw error;
    }
  },

  releaseCredits(input: BaseCreditInput) {
    return creditWalletService.release(input);
  },

  grantCredits(input: BaseCreditInput & { type: CreditTransactionType }) {
    if (!GRANT_TYPES.includes(input.type)) {
      throw new AppError(400, '不支持的额度发放类型', 'INVALID_CREDIT_TYPE');
    }
    return creditWalletService.grant(input);
  },

  purchaseCredits(input: BaseCreditInput) {
    return creditWalletService.purchase(input);
  },

  refundCredits(input: BaseCreditInput) {
    return creditWalletService.refund(input);
  },
};
