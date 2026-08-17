import { CreditTransactionType, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';

type WalletOperation = 'CREDIT' | 'DEBIT' | 'RESERVE' | 'RELEASE' | 'CONSUME_RESERVED';

export type WalletMutationInput = {
  licenseId: string;
  amount: number;
  type: CreditTransactionType;
  idempotencyKey: string;
  description: string;
  orderId?: string;
  usageId?: string;
};

export type WalletMutationResult = {
  transactionId: string;
  balanceBefore: number;
  balanceAfter: number;
  idempotent: boolean;
};

const MAX_OPTIMISTIC_LOCK_RETRIES = 3;

function validateInput(input: WalletMutationInput): void {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new AppError(400, '额度变动数量必须为正整数', 'INVALID_CREDIT_AMOUNT');
  }
  if (!input.idempotencyKey.trim()) {
    throw new AppError(400, '缺少幂等键', 'IDEMPOTENCY_KEY_REQUIRED');
  }
  if (!input.description.trim()) {
    throw new AppError(400, '缺少额度变动说明', 'DESCRIPTION_REQUIRED');
  }
}

async function findExisting(idempotencyKey: string): Promise<WalletMutationResult | null> {
  const existing = await prisma.creditTransaction.findUnique({
    where: { idempotencyKey },
  });
  if (!existing) return null;
  return {
    transactionId: existing.id,
    balanceBefore: existing.balanceBefore,
    balanceAfter: existing.balanceAfter,
    idempotent: true,
  };
}

async function mutateOnce(
  input: WalletMutationInput,
  operation: WalletOperation,
): Promise<WalletMutationResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.creditTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return {
        transactionId: existing.id,
        balanceBefore: existing.balanceBefore,
        balanceAfter: existing.balanceAfter,
        idempotent: true,
      };
    }

    const wallet = await tx.creditWallet.findUnique({
      where: { licenseId: input.licenseId },
    });
    if (!wallet) {
      throw new AppError(404, 'License 额度账户不存在', 'WALLET_NOT_FOUND');
    }

    const debitsBalance = operation === 'DEBIT' || operation === 'RESERVE';
    const debitsReserve = operation === 'RELEASE' || operation === 'CONSUME_RESERVED';
    if (debitsBalance && wallet.balance < input.amount) {
      throw new AppError(402, 'AI 积分不足，请购买积分后继续使用。', 'INSUFFICIENT_CREDITS');
    }
    if (debitsReserve && wallet.reservedBalance < input.amount) {
      throw new AppError(409, '预留积分不足', 'INSUFFICIENT_RESERVED_CREDITS');
    }

    const balanceAfter =
      operation === 'CREDIT' || operation === 'RELEASE'
        ? wallet.balance + input.amount
        : debitsBalance
          ? wallet.balance - input.amount
          : wallet.balance;

    const data: Prisma.CreditWalletUpdateManyMutationInput = {
      version: { increment: 1 },
    };
    if (operation === 'CREDIT') data.balance = { increment: input.amount };
    if (operation === 'DEBIT') {
      data.balance = { decrement: input.amount };
      data.totalConsumed = { increment: input.amount };
    }
    if (operation === 'RESERVE') {
      data.balance = { decrement: input.amount };
      data.reservedBalance = { increment: input.amount };
    }
    if (operation === 'RELEASE') {
      data.balance = { increment: input.amount };
      data.reservedBalance = { decrement: input.amount };
    }
    if (operation === 'CONSUME_RESERVED') {
      data.reservedBalance = { decrement: input.amount };
      data.totalConsumed = { increment: input.amount };
    }
    if (input.type === 'PURCHASE') data.totalPurchased = { increment: input.amount };
    if (
      operation === 'CREDIT' &&
      ['SUBSCRIPTION_GRANT', 'ADMIN_ADJUSTMENT', 'PROMOTION'].includes(input.type)
    ) {
      data.totalGranted = { increment: input.amount };
    }

    const updated = await tx.creditWallet.updateMany({
      where: {
        id: wallet.id,
        version: wallet.version,
        ...(debitsBalance ? { balance: { gte: input.amount } } : {}),
        ...(debitsReserve ? { reservedBalance: { gte: input.amount } } : {}),
      },
      data,
    });
    if (updated.count !== 1) {
      throw new AppError(409, '额度账户发生并发更新', 'WALLET_VERSION_CONFLICT');
    }

    const transaction = await tx.creditTransaction.create({
      data: {
        licenseId: input.licenseId,
        orderId: input.orderId,
        usageId: input.usageId,
        type: input.type,
        amount: input.amount,
        balanceBefore: wallet.balance,
        balanceAfter,
        reason: input.description,
        description: input.description,
        idempotencyKey: input.idempotencyKey,
      },
    });

    return {
      transactionId: transaction.id,
      balanceBefore: wallet.balance,
      balanceAfter,
      idempotent: false,
    };
  });
}

async function mutate(
  input: WalletMutationInput,
  operation: WalletOperation,
): Promise<WalletMutationResult> {
  validateInput(input);

  for (let attempt = 0; attempt < MAX_OPTIMISTIC_LOCK_RETRIES; attempt += 1) {
    try {
      return await mutateOnce(input, operation);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await findExisting(input.idempotencyKey);
        if (existing) return existing;
      }
      if (
        error instanceof AppError &&
        error.code === 'WALLET_VERSION_CONFLICT' &&
        attempt < MAX_OPTIMISTIC_LOCK_RETRIES - 1
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new AppError(409, '额度账户更新冲突，请重试', 'WALLET_VERSION_CONFLICT');
}

export const creditWalletService = {
  purchase(input: Omit<WalletMutationInput, 'type'>) {
    return mutate({ ...input, type: 'PURCHASE' }, 'CREDIT');
  },
  grant(input: WalletMutationInput) {
    if (!['SUBSCRIPTION_GRANT', 'ADMIN_ADJUSTMENT', 'PROMOTION'].includes(input.type)) {
      throw new AppError(400, '不支持的额度发放类型', 'INVALID_CREDIT_TYPE');
    }
    return mutate(input, 'CREDIT');
  },
  consume(input: Omit<WalletMutationInput, 'type'>) {
    return mutate({ ...input, type: 'CONSUME' }, 'DEBIT');
  },
  reserve(input: Omit<WalletMutationInput, 'type'>) {
    return mutate({ ...input, type: 'RESERVE' }, 'RESERVE');
  },
  release(input: Omit<WalletMutationInput, 'type'>) {
    return mutate({ ...input, type: 'RELEASE' }, 'RELEASE');
  },
  consumeReserved(input: Omit<WalletMutationInput, 'type'>) {
    return mutate({ ...input, type: 'CONSUME' }, 'CONSUME_RESERVED');
  },
  refund(input: Omit<WalletMutationInput, 'type'>) {
    return mutate({ ...input, type: 'REFUND' }, 'CREDIT');
  },
};
