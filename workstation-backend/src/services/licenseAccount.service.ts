import { prisma } from '../config/database';
import { AppError } from '../utils/errors';

function normalizedLimit(limit?: number): number {
  if (!Number.isInteger(limit) || (limit ?? 0) <= 0) return 50;
  return Math.min(limit!, 100);
}

export const licenseAccountService = {
  async getWallet(licenseId: string) {
    const wallet = await prisma.creditWallet.findUnique({ where: { licenseId } });
    if (!wallet) {
      throw new AppError(404, 'License 额度账户不存在', 'WALLET_NOT_FOUND');
    }
    return {
      balance: wallet.balance,
      reservedBalance: wallet.reservedBalance,
      totalPurchased: wallet.totalPurchased,
      totalGranted: wallet.totalGranted,
      totalConsumed: wallet.totalConsumed,
      updatedAt: wallet.updatedAt,
    };
  },

  listTransactions(licenseId: string, limit?: number) {
    return prisma.creditTransaction.findMany({
      where: { licenseId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: normalizedLimit(limit),
      select: {
        id: true,
        type: true,
        amount: true,
        balanceBefore: true,
        balanceAfter: true,
        description: true,
        orderId: true,
        usageId: true,
        createdAt: true,
      },
    });
  },

  async listUsage(licenseId: string, limit?: number) {
    const rows = await prisma.aiUsage.findMany({
      where: { licenseId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: normalizedLimit(limit),
      select: {
        id: true,
        taskType: true,
        templateVersion: true,
        provider: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        providerCostMicros: true,
        creditsReserved: true,
        creditsCharged: true,
        status: true,
        requestId: true,
        errorCode: true,
        createdAt: true,
        completedAt: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      providerCostMicros: row.providerCostMicros.toString(),
    }));
  },
};
