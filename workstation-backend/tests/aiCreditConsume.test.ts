import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { env } from '../src/config/env';
import {
  AI_CONSUME_SOURCE_TYPE,
  computeFinalAiCost,
  consumeAiCredits,
  convertTokenUsageToCreditCosts,
  tokensToCreditCost,
} from '../src/services/aiCreditConsume.service';
import { aiTaskExecutionService } from '../src/services/aiTaskExecution.service';

describe('Phase 6 AI credit consume — formula (unit)', () => {
  it('finalCost uses minCost when input+output is smaller', () => {
    expect(computeFinalAiCost(10, 3, 4)).toBe(10);
  });

  it('finalCost uses input+output when larger than minCost', () => {
    expect(computeFinalAiCost(5, 4, 7)).toBe(11);
  });

  it('tokensToCreditCost uses Decimal ceil, not float mul', () => {
    // ceil(1500 * 1 / 1000) = 2
    expect(tokensToCreditCost(1500, 1)).toBe(2);
    // ceil(1 * 1 / 1000) = 1
    expect(tokensToCreditCost(1, 1)).toBe(1);
    // ceil(999 * 1 / 1000) = 1
    expect(tokensToCreditCost(999, 1)).toBe(1);
    // ceil(1000 * 1.5 / 1000) = 2
    expect(tokensToCreditCost(1000, '1.5')).toBe(2);
    // ceil(1001 * 1.5 / 1000) = ceil(1.5015) = 2
    expect(tokensToCreditCost(1001, '1.5')).toBe(2);
  });

  it('convertTokenUsageToCreditCosts reads env rates (not raw tokens)', () => {
    const prevIn = env.aiInputCreditPer1kTokens;
    const prevOut = env.aiOutputCreditPer1kTokens;
    const prevMin = env.aiMinCreditCost;
    const prevChatMin = env.aiChatMinCreditCost;
    env.aiInputCreditPer1kTokens = 1;
    env.aiOutputCreditPer1kTokens = 2;
    env.aiMinCreditCost = 5;
    env.aiChatMinCreditCost = 5;
    try {
      const costs = convertTokenUsageToCreditCosts(2000, 1000);
      // input=ceil(2000*1/1000)=2, output=ceil(1000*2/1000)=2 — not raw 2000/1000
      expect(costs.input).toBe(2);
      expect(costs.output).toBe(2);
      expect(costs.minCost).toBe(5);
      expect(computeFinalAiCost(costs.minCost, costs.input, costs.output)).toBe(5);
      expect(costs.input).not.toBe(2000);
      expect(costs.output).not.toBe(1000);
    } finally {
      env.aiInputCreditPer1kTokens = prevIn;
      env.aiOutputCreditPer1kTokens = prevOut;
      env.aiMinCreditCost = prevMin;
      env.aiChatMinCreditCost = prevChatMin;
    }
  });
});

describe('Phase 6 AI credit consume — transaction (integration)', () => {
  const suffix = randomUUID().slice(0, 8);
  let userId = '';
  let organizationId = '';

  beforeAll(async () => {
    await connectDatabase();
    const user = await prisma.user.create({
      data: {
        username: `ai_c_${suffix}`,
        email: `ai_c_${suffix}@example.com`,
        passwordHash: 'x',
      },
    });
    userId = user.id;
    const org = await prisma.organization.create({
      data: {
        name: `ai consume ${suffix}`,
        slug: `ai-c-${suffix}`,
        members: { create: { userId, role: 'owner', status: 'active' } },
        creditAccount: {
          create: { balance: 100, frozenBalance: 0, totalRecharged: 0, totalConsumed: 0 },
        },
      },
    });
    organizationId = org.id;
  });

  afterAll(async () => {
    await prisma.creditLedger.deleteMany({ where: { organizationId } });
    await prisma.creditAccount.deleteMany({ where: { organizationId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await disconnectDatabase();
  });

  async function resetBalance(balance: number, totalConsumed = 0) {
    await prisma.creditLedger.deleteMany({
      where: { organizationId, sourceType: AI_CONSUME_SOURCE_TYPE },
    });
    await prisma.creditAccount.update({
      where: { organizationId },
      data: { balance, frozenBalance: 0, totalConsumed },
    });
  }

  it('charges minCost when input+output < minCost; totalConsumed += finalCost (not +1)', async () => {
    await resetBalance(100, 0);
    const result = await consumeAiCredits({
      organizationId,
      userId,
      requestId: `min-${randomUUID()}`,
      minCost: 10,
      input: 3,
      output: 4,
    });
    expect(result.finalCost).toBe(10);
    expect(result.idempotent).toBe(false);
    expect(result.balanceBefore).toBe(100);
    expect(result.balanceAfter).toBe(90);

    const account = await prisma.creditAccount.findUniqueOrThrow({
      where: { organizationId },
    });
    expect(account.balance).toBe(90);
    expect(account.totalConsumed).toBe(10);

    const ledger = await prisma.creditLedger.findUniqueOrThrow({
      where: { id: result.ledgerId },
    });
    expect(ledger.amount).toBe(10);
    expect(ledger.balanceBefore).toBe(100);
    expect(ledger.balanceAfter).toBe(90);
    expect(ledger.sourceType).toBe(AI_CONSUME_SOURCE_TYPE);
  });

  it('charges input+output when greater than minCost; totalConsumed increases by actual amount', async () => {
    await resetBalance(100, 5);
    const result = await consumeAiCredits({
      organizationId,
      userId,
      requestId: `sum-${randomUUID()}`,
      minCost: 5,
      input: 4,
      output: 7,
    });
    expect(result.finalCost).toBe(11);

    const account = await prisma.creditAccount.findUniqueOrThrow({
      where: { organizationId },
    });
    expect(account.balance).toBe(89);
    expect(account.totalConsumed).toBe(16); // 5 + 11, not 5 + 1
  });

  it('succeeds when balance exactly equals finalCost (balance → 0)', async () => {
    await resetBalance(11, 0);
    const result = await consumeAiCredits({
      organizationId,
      userId,
      requestId: `exact-${randomUUID()}`,
      minCost: 5,
      input: 4,
      output: 7,
    });
    expect(result.finalCost).toBe(11);
    expect(result.balanceAfter).toBe(0);

    const account = await prisma.creditAccount.findUniqueOrThrow({
      where: { organizationId },
    });
    expect(account.balance).toBe(0);
    expect(account.totalConsumed).toBe(11);
  });

  it('fails when balance < finalCost; no ledger row written', async () => {
    await resetBalance(5, 0);
    const requestId = `short-${randomUUID()}`;
    await expect(
      consumeAiCredits({
        organizationId,
        userId,
        requestId,
        minCost: 10,
        input: 0,
        output: 0,
      }),
    ).rejects.toMatchObject({ statusCode: 402, code: 'INSUFFICIENT_CREDITS' });

    const account = await prisma.creditAccount.findUniqueOrThrow({
      where: { organizationId },
    });
    expect(account.balance).toBe(5);
    expect(account.totalConsumed).toBe(0);
    expect(
      await prisma.creditLedger.count({
        where: { sourceType: AI_CONSUME_SOURCE_TYPE, sourceId: requestId },
      }),
    ).toBe(0);
  });

  it('same requestId sequential calls debit only once', async () => {
    await resetBalance(100, 0);
    const requestId = `idem-${randomUUID()}`;
    const first = await consumeAiCredits({
      organizationId,
      userId,
      requestId,
      minCost: 10,
      input: 0,
      output: 0,
    });
    const second = await consumeAiCredits({
      organizationId,
      userId,
      requestId,
      minCost: 10,
      input: 0,
      output: 0,
    });
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.ledgerId).toBe(first.ledgerId);

    const account = await prisma.creditAccount.findUniqueOrThrow({
      where: { organizationId },
    });
    expect(account.balance).toBe(90);
    expect(account.totalConsumed).toBe(10);
    expect(
      await prisma.creditLedger.count({
        where: { sourceType: AI_CONSUME_SOURCE_TYPE, sourceId: requestId },
      }),
    ).toBe(1);
  });

  it('same requestId concurrent calls debit only once', async () => {
    await resetBalance(100, 0);
    const requestId = `conc-${randomUUID()}`;
    const input = {
      organizationId,
      userId,
      requestId,
      minCost: 10,
      input: 0,
      output: 0,
    };
    const results = await Promise.all([
      consumeAiCredits(input),
      consumeAiCredits(input),
      consumeAiCredits(input),
    ]);
    const fresh = results.filter((r) => !r.idempotent);
    expect(fresh.length).toBe(1);
    expect(results.every((r) => r.ledgerId === fresh[0]!.ledgerId)).toBe(true);

    const account = await prisma.creditAccount.findUniqueOrThrow({
      where: { organizationId },
    });
    expect(account.balance).toBe(90);
    expect(account.totalConsumed).toBe(10);
    expect(
      await prisma.creditLedger.count({
        where: { sourceType: AI_CONSUME_SOURCE_TYPE, sourceId: requestId },
      }),
    ).toBe(1);
  });

  it('two different requestIds concurrent never drive balance negative', async () => {
    await resetBalance(15, 0);
    const a = `a-${randomUUID()}`;
    const b = `b-${randomUUID()}`;
    const settled = await Promise.allSettled([
      consumeAiCredits({
        organizationId,
        userId,
        requestId: a,
        minCost: 10,
        input: 0,
        output: 0,
      }),
      consumeAiCredits({
        organizationId,
        userId,
        requestId: b,
        minCost: 10,
        input: 0,
        output: 0,
      }),
    ]);
    const ok = settled.filter((s) => s.status === 'fulfilled');
    const fail = settled.filter((s) => s.status === 'rejected');
    expect(ok.length).toBe(1);
    expect(fail.length).toBe(1);
    expect((fail[0] as PromiseRejectedResult).reason).toMatchObject({
      statusCode: 402,
      code: 'INSUFFICIENT_CREDITS',
    });

    const account = await prisma.creditAccount.findUniqueOrThrow({
      where: { organizationId },
    });
    expect(account.balance).toBe(5);
    expect(account.balance).toBeGreaterThanOrEqual(0);
    expect(account.totalConsumed).toBe(10);
    expect(
      await prisma.creditLedger.count({
        where: {
          organizationId,
          sourceType: AI_CONSUME_SOURCE_TYPE,
          sourceId: { in: [a, b] },
        },
      }),
    ).toBe(1);
  });
});

describe('Phase 6 AI credit consume — LLM failure does not debit', () => {
  const suffix = randomUUID().slice(0, 8);
  let userId = '';
  let organizationId = '';
  let taskCode = '';

  beforeAll(async () => {
    await connectDatabase();
    const user = await prisma.user.create({
      data: {
        username: `ai_f_${suffix}`,
        email: `ai_f_${suffix}@example.com`,
        passwordHash: 'x',
      },
    });
    userId = user.id;
    const org = await prisma.organization.create({
      data: {
        name: `ai fail ${suffix}`,
        slug: `ai-f-${suffix}`,
        members: { create: { userId, role: 'owner', status: 'active' } },
        creditAccount: {
          create: { balance: 10_000, frozenBalance: 0, totalRecharged: 0, totalConsumed: 0 },
        },
      },
    });
    organizationId = org.id;
    taskCode = `ai-fail-${suffix}`;
    await prisma.taskTemplate.create({
      data: {
        code: taskCode,
        agentType: 'HR_AGENT',
        name: 'fail provider',
        description: 'llm fail no debit',
        version: '1.0.0',
        creditCost: 1,
        modelConfig: {},
        promptTemplate: 'fail',
        inputSchema: {},
        outputSchema: {},
      },
    });
  });

  afterAll(async () => {
    await prisma.aiUsage.deleteMany({
      where: { taskType: taskCode },
    });
    await prisma.taskTemplate.deleteMany({ where: { code: taskCode } });
    await prisma.creditLedger.deleteMany({ where: { organizationId } });
    await prisma.creditAccount.deleteMany({ where: { organizationId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await disconnectDatabase();
  });

  it('LLM provider failure does not write AI_CONSUME ledger or change totalConsumed', async () => {
    const { initLlmRuntimeFromEnv } = await import('../src/providers/llm/llmRuntime');
    const prev = {
      enforce: env.licenseEnforcementEnabled,
      provider: env.modelProvider,
      llmApiKey: env.llmApiKey,
      llmBaseUrl: env.llmBaseUrl,
      openaiApiKey: env.openaiApiKey,
      deepseekApiKey: env.deepseekApiKey,
    };
    env.licenseEnforcementEnabled = true;
    env.modelProvider = 'custom';
    env.llmApiKey = '';
    env.llmBaseUrl = '';
    env.openaiApiKey = '';
    env.deepseekApiKey = '';
    initLlmRuntimeFromEnv();
    const requestId = randomUUID();
    try {
      await expect(
        aiTaskExecutionService.execute({
          userId,
          organizationId,
          taskCode,
          templateVersion: '1.0.0',
          structuredInput: { value: 1 },
          requestId,
        }),
      ).rejects.toMatchObject({ code: 'LLM_PROVIDER_UNAVAILABLE' });

      const account = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(account.balance).toBe(10000);
      expect(account.totalConsumed).toBe(0);
      expect(
        await prisma.creditLedger.count({
          where: { organizationId, sourceType: AI_CONSUME_SOURCE_TYPE },
        }),
      ).toBe(0);

      const usage = await prisma.aiUsage.findUnique({ where: { requestId } });
      expect(usage?.status).toBe('FAILED');
      expect(usage?.errorCode).toBe('LLM_PROVIDER_UNAVAILABLE');
      expect(usage?.errorCode).not.toBe('BILLING_FAILED_AFTER_LLM');
    } finally {
      env.licenseEnforcementEnabled = prev.enforce;
      env.modelProvider = prev.provider;
      env.llmApiKey = prev.llmApiKey;
      env.llmBaseUrl = prev.llmBaseUrl;
      env.openaiApiKey = prev.openaiApiKey;
      env.deepseekApiKey = prev.deepseekApiKey;
      initLlmRuntimeFromEnv();
    }
  });
});
