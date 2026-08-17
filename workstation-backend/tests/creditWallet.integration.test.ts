import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { creditWalletService } from '../src/services/creditWallet.service';

describe('credit wallet concurrency and idempotency', () => {
  let licenseId: string;

  beforeAll(async () => {
    await connectDatabase();
  });

  beforeEach(async () => {
    const license = await prisma.license.create({
      data: {
        licenseCodeHash: `test-${randomUUID()}`,
        productType: 'HR_AGENT',
        wallet: { create: { balance: 100 } },
      },
    });
    licenseId = license.id;
  });

  afterAll(async () => {
    await prisma.creditTransaction.deleteMany({
      where: { license: { licenseCodeHash: { startsWith: 'test-' } } },
    });
    await prisma.aiUsage.deleteMany({
      where: { license: { licenseCodeHash: { startsWith: 'test-' } } },
    });
    await prisma.creditWallet.deleteMany({
      where: { license: { licenseCodeHash: { startsWith: 'test-' } } },
    });
    await prisma.license.deleteMany({
      where: { licenseCodeHash: { startsWith: 'test-' } },
    });
    await disconnectDatabase();
  });

  it('deduplicates concurrent requests with the same idempotency key', async () => {
    const input = {
      licenseId,
      amount: 20,
      idempotencyKey: `consume:${randomUUID()}`,
      description: 'integration test consume',
    };

    const [first, second] = await Promise.all([
      creditWalletService.consume(input),
      creditWalletService.consume(input),
    ]);

    const wallet = await prisma.creditWallet.findUniqueOrThrow({ where: { licenseId } });
    const transactions = await prisma.creditTransaction.findMany({
      where: { idempotencyKey: input.idempotencyKey },
    });

    expect(first.transactionId).toBe(second.transactionId);
    expect(wallet.balance).toBe(80);
    expect(wallet.totalConsumed).toBe(20);
    expect(transactions).toHaveLength(1);
  });

  it('prevents two distinct concurrent debits from overspending', async () => {
    await prisma.creditWallet.update({
      where: { licenseId },
      data: { balance: 10 },
    });

    const results = await Promise.allSettled([
      creditWalletService.consume({
        licenseId,
        amount: 7,
        idempotencyKey: `consume:${randomUUID()}`,
        description: 'concurrent debit A',
      }),
      creditWalletService.consume({
        licenseId,
        amount: 7,
        idempotencyKey: `consume:${randomUUID()}`,
        description: 'concurrent debit B',
      }),
    ]);

    const wallet = await prisma.creditWallet.findUniqueOrThrow({ where: { licenseId } });
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(wallet.balance).toBe(3);
    expect(wallet.totalConsumed).toBe(7);
  });

  it('tracks reserved credits separately before final consumption', async () => {
    const usage = await prisma.aiUsage.create({
      data: {
        licenseId,
        taskType: 'HR_SUMMARY',
        templateVersion: '1.0.0',
        provider: 'mock',
        model: 'mock',
        requestId: randomUUID(),
      },
    });

    await creditWalletService.reserve({
      licenseId,
      usageId: usage.id,
      amount: 15,
      idempotencyKey: `reserve:${usage.id}`,
      description: 'reserve AI task credits',
    });
    await creditWalletService.consumeReserved({
      licenseId,
      usageId: usage.id,
      amount: 15,
      idempotencyKey: `consume-reserved:${usage.id}`,
      description: 'finalize AI task credits',
    });

    const wallet = await prisma.creditWallet.findUniqueOrThrow({ where: { licenseId } });
    expect(wallet.balance).toBe(85);
    expect(wallet.reservedBalance).toBe(0);
    expect(wallet.totalConsumed).toBe(15);
  });
});
