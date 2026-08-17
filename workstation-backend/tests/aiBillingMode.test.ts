import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { env } from '../src/config/env';
import {
  AI_CONSUME_SOURCE_TYPE,
  assertBalanceForBillingMode,
  consumeAiCreditsByMode,
} from '../src/services/aiCreditConsume.service';
import {
  BillingMode,
  assertAgentRunCanContinue,
  beginOrGetAgentRun,
  computeBillingModeCost,
  recordAgentRunCharge,
  resetAgentRunBudgetsForTests,
} from '../src/services/aiBillingMode';
import { SIGNUP_BONUS_SOURCE_TYPE, orgCreditService } from '../src/services/orgCredit.service';
import { AppError } from '../src/utils/errors';

describe('billingMode cost formula (unit)', () => {
  const snapshot = {
    in: env.aiInputCreditPer1kTokens,
    out: env.aiOutputCreditPer1kTokens,
    chatMul: env.aiChatMultiplier,
    chatMin: env.aiChatMinCreditCost,
    agentMul: env.aiAgentMultiplier,
    agentMin: env.aiAgentMinCreditCost,
    wfMul: env.aiWorkflowMultiplier,
    wfMin: env.aiWorkflowMinCreditCost,
  };

  beforeEach(() => {
    env.aiInputCreditPer1kTokens = 30;
    env.aiOutputCreditPer1kTokens = 120;
    env.aiChatMultiplier = 1;
    env.aiChatMinCreditCost = 20;
    env.aiAgentMultiplier = 2;
    env.aiAgentMinCreditCost = 300;
    env.aiWorkflowMultiplier = 2.5;
    env.aiWorkflowMinCreditCost = 500;
  });

  afterAll(() => {
    Object.assign(env, {
      aiInputCreditPer1kTokens: snapshot.in,
      aiOutputCreditPer1kTokens: snapshot.out,
      aiChatMultiplier: snapshot.chatMul,
      aiChatMinCreditCost: snapshot.chatMin,
      aiAgentMultiplier: snapshot.agentMul,
      aiAgentMinCreditCost: snapshot.agentMin,
      aiWorkflowMultiplier: snapshot.wfMul,
      aiWorkflowMinCreditCost: snapshot.wfMin,
    });
  });

  it('CHAT / AGENT / WORKFLOW multipliers are applied correctly', () => {
    // inputCost=ceil(1000*30/1000)=30, outputCost=ceil(1000*120/1000)=120, base=150
    const chat = computeBillingModeCost({
      billingMode: BillingMode.Chat,
      inputTokens: 1000,
      outputTokens: 1000,
    });
    expect(chat.inputCost).toBe(30);
    expect(chat.outputCost).toBe(120);
    expect(chat.finalCost).toBe(150); // 150 * 1

    const agent = computeBillingModeCost({
      billingMode: BillingMode.Agent,
      inputTokens: 1000,
      outputTokens: 1000,
    });
    expect(agent.finalCost).toBe(300); // max(300, 150*2)

    const workflow = computeBillingModeCost({
      billingMode: BillingMode.Workflow,
      inputTokens: 1000,
      outputTokens: 1000,
    });
    expect(workflow.finalCost).toBe(500); // max(500, ceil(150*2.5)=375) → 500
  });

  it('applies three mode minimums when scaled cost is smaller', () => {
    // tiny usage: inputCost=ceil(1*30/1000)=1, output=ceil(1*120/1000)=1, base=2
    const chat = computeBillingModeCost({
      billingMode: BillingMode.Chat,
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(chat.finalCost).toBe(20);

    const agent = computeBillingModeCost({
      billingMode: BillingMode.Agent,
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(agent.finalCost).toBe(300);

    const workflow = computeBillingModeCost({
      billingMode: BillingMode.Workflow,
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(workflow.finalCost).toBe(500);
  });

  it('ceil after multiplier (WORKFLOW 2.5)', () => {
    // input=2000→60, output=1000→120, base=180, 180*2.5=450 → final max(500,450)=500
    const low = computeBillingModeCost({
      billingMode: BillingMode.Workflow,
      inputTokens: 2000,
      outputTokens: 1000,
    });
    expect(low.finalCost).toBe(500);

    // input=10000→300, output=10000→1200, base=1500, 1500*2.5=3750
    const high = computeBillingModeCost({
      billingMode: BillingMode.Workflow,
      inputTokens: 10_000,
      outputTokens: 10_000,
    });
    expect(high.finalCost).toBe(3750);
  });
});

describe('Agent run budget limits (unit)', () => {
  beforeEach(() => {
    resetAgentRunBudgetsForTests();
    env.aiAgentMaxCreditPerRun = 20_000;
    env.aiAgentMaxSteps = 8;
    env.aiAgentMinCreditCost = 300;
  });

  it('stops when cumulative spend reaches 20000', () => {
    const agentRunId = randomUUID();
    beginOrGetAgentRun({
      agentRunId,
      organizationId: 'org',
      userId: 'user',
    });
    recordAgentRunCharge(agentRunId, 20_000);
    expect(() => assertAgentRunCanContinue(agentRunId)).toThrow(AppError);
    try {
      assertAgentRunCanContinue(agentRunId);
    } catch (e) {
      expect(e).toMatchObject({ code: 'AGENT_CREDIT_LIMIT_REACHED', statusCode: 402 });
    }
  });

  it('stops after 8 steps and asks user to confirm continue', () => {
    const agentRunId = randomUUID();
    beginOrGetAgentRun({
      agentRunId,
      organizationId: 'org',
      userId: 'user',
    });
    for (let i = 0; i < 8; i += 1) {
      assertAgentRunCanContinue(agentRunId);
      recordAgentRunCharge(agentRunId, 300);
    }
    expect(() => assertAgentRunCanContinue(agentRunId)).toThrow(AppError);
    try {
      assertAgentRunCanContinue(agentRunId);
    } catch (e) {
      expect(e).toMatchObject({ code: 'AGENT_STEP_LIMIT_REACHED', statusCode: 409 });
    }
  });
});

describe('billingMode debit + signup bonus + lowBalance (integration)', () => {
  const suffix = randomUUID().slice(0, 8);
  let userId = '';
  let organizationId = '';

  beforeAll(async () => {
    await connectDatabase();
    const user = await prisma.user.create({
      data: {
        username: `bm_${suffix}`,
        email: `bm_${suffix}@example.com`,
        passwordHash: 'x',
      },
    });
    userId = user.id;
    const org = await prisma.organization.create({
      data: {
        name: `billing mode ${suffix}`,
        slug: `bm-${suffix}`,
        members: { create: { userId, role: 'owner', status: 'active' } },
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

  it('grants signup bonus 10000 only once on first CreditAccount create', async () => {
    const prevBonus = env.signupBonusCredits;
    env.signupBonusCredits = 10_000;
    try {
      const first = await orgCreditService.ensureAccount(organizationId, { userId });
      const second = await orgCreditService.ensureAccount(organizationId, { userId });
      expect(first.id).toBe(second.id);
      expect(first.balance).toBe(10_000);
      expect(second.balance).toBe(10_000);

      const bonusRows = await prisma.creditLedger.findMany({
        where: {
          organizationId,
          sourceType: SIGNUP_BONUS_SOURCE_TYPE,
          sourceId: `signup:${organizationId}`,
        },
      });
      expect(bonusRows).toHaveLength(1);
      expect(bonusRows[0]!.amount).toBe(10_000);
      expect(bonusRows[0]!.description).toMatch(/BONUS/);
    } finally {
      env.signupBonusCredits = prevBonus;
    }
  });

  it('lowBalance is true when available < threshold', async () => {
    const prev = env.creditLowBalanceThreshold;
    env.creditLowBalanceThreshold = 5_000;
    try {
      await prisma.creditAccount.update({
        where: { organizationId },
        data: { balance: 4_999, frozenBalance: 0 },
      });
      const account = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId },
      });
      const available = account.balance - account.frozenBalance;
      expect(available < env.creditLowBalanceThreshold).toBe(true);

      await prisma.creditAccount.update({
        where: { organizationId },
        data: { balance: 5_000, frozenBalance: 0 },
      });
      const ok = await prisma.creditAccount.findUniqueOrThrow({
        where: { organizationId },
      });
      expect(ok.balance - ok.frozenBalance < env.creditLowBalanceThreshold).toBe(false);
    } finally {
      env.creditLowBalanceThreshold = prev;
    }
  });

  it('preflight returns 402 when balance < mode minimum', async () => {
    await prisma.creditAccount.update({
      where: { organizationId },
      data: { balance: 100, frozenBalance: 0 },
    });
    await expect(
      assertBalanceForBillingMode(organizationId, BillingMode.Agent),
    ).rejects.toMatchObject({ statusCode: 402, code: 'INSUFFICIENT_CREDITS' });
  });

  it('same requestId does not double-debit under mode billing', async () => {
    await prisma.creditLedger.deleteMany({
      where: { organizationId, sourceType: AI_CONSUME_SOURCE_TYPE },
    });
    await prisma.creditAccount.update({
      where: { organizationId },
      data: { balance: 10_000, frozenBalance: 0, totalConsumed: 0 },
    });

    const requestId = `mode-idem-${randomUUID()}`;
    const input = {
      organizationId,
      userId,
      requestId,
      billingMode: BillingMode.Chat,
      inputTokens: 1,
      outputTokens: 1,
    };
    const first = await consumeAiCreditsByMode(input);
    const second = await consumeAiCreditsByMode(input);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.ledgerId).toBe(first.ledgerId);
    expect(first.finalCost).toBe(20);

    const account = await prisma.creditAccount.findUniqueOrThrow({
      where: { organizationId },
    });
    expect(account.balance).toBe(10_000 - 20);
    expect(account.totalConsumed).toBe(20);
    expect(
      await prisma.creditLedger.count({
        where: { sourceType: AI_CONSUME_SOURCE_TYPE, sourceId: requestId },
      }),
    ).toBe(1);

    const ledger = await prisma.creditLedger.findUniqueOrThrow({
      where: { id: first.ledgerId },
    });
    expect(ledger.description).toMatch(/billingMode=CHAT/);
    expect(ledger.description).toMatch(/finalCost=20/);
  });

  it('AGENT / WORKFLOW debit amounts follow mode formula', async () => {
    await prisma.creditLedger.deleteMany({
      where: { organizationId, sourceType: AI_CONSUME_SOURCE_TYPE },
    });
    await prisma.creditAccount.update({
      where: { organizationId },
      data: { balance: 50_000, frozenBalance: 0, totalConsumed: 0 },
    });

    const agent = await consumeAiCreditsByMode({
      organizationId,
      userId,
      requestId: `agent-${randomUUID()}`,
      billingMode: BillingMode.Agent,
      inputTokens: 1000,
      outputTokens: 1000,
    });
    expect(agent.finalCost).toBe(300);

    const workflow = await consumeAiCreditsByMode({
      organizationId,
      userId,
      requestId: `wf-${randomUUID()}`,
      billingMode: BillingMode.Workflow,
      inputTokens: 10_000,
      outputTokens: 10_000,
    });
    expect(workflow.finalCost).toBe(3750);

    const account = await prisma.creditAccount.findUniqueOrThrow({
      where: { organizationId },
    });
    expect(account.totalConsumed).toBe(300 + 3750);
  });
});
