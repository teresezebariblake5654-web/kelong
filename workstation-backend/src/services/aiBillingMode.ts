import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { AppError } from '../utils/errors';

const Decimal = Prisma.Decimal;

export const BillingMode = {
  Chat: 'CHAT',
  Agent: 'AGENT',
  Workflow: 'WORKFLOW',
} as const;

export type BillingModeValue = (typeof BillingMode)[keyof typeof BillingMode];

export type BillingModeQuote = {
  billingMode: BillingModeValue;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  multiplier: number;
  minCost: number;
  finalCost: number;
};

function toNonNegInt(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new AppError(400, `${label} 无效`, 'INVALID_CREDIT_AMOUNT');
  }
  return Math.trunc(value);
}

function tokensToCreditCostCeil(tokens: number, creditsPer1k: number | string): number {
  const tokenInt = toNonNegInt(tokens, 'tokens');
  const rate = new Decimal(creditsPer1k);
  if (rate.isNeg()) {
    throw new AppError(400, '额度费率无效', 'INVALID_CREDIT_RATE');
  }
  if (tokenInt === 0 || rate.isZero()) return 0;
  return Number(new Decimal(tokenInt).mul(rate).div(1000).toDecimalPlaces(0, Decimal.ROUND_CEIL));
}

function modeParams(mode: BillingModeValue): { multiplier: number; minCost: number } {
  switch (mode) {
    case BillingMode.Chat:
      return { multiplier: env.aiChatMultiplier, minCost: env.aiChatMinCreditCost };
    case BillingMode.Agent:
      return { multiplier: env.aiAgentMultiplier, minCost: env.aiAgentMinCreditCost };
    case BillingMode.Workflow:
      return { multiplier: env.aiWorkflowMultiplier, minCost: env.aiWorkflowMinCreditCost };
    default:
      throw new AppError(400, '未知计费模式', 'INVALID_BILLING_MODE');
  }
}

/**
 * Mode-aware App credit quote (Decimal, ceil).
 * finalCost = max(minCost, ceil((inputCost + outputCost) * multiplier))
 */
export function computeBillingModeCost(input: {
  billingMode: BillingModeValue;
  inputTokens: number;
  outputTokens: number;
}): BillingModeQuote {
  const inputTokens = toNonNegInt(input.inputTokens, 'inputTokens');
  const outputTokens = toNonNegInt(input.outputTokens, 'outputTokens');
  const { multiplier, minCost } = modeParams(input.billingMode);

  const inputCost = tokensToCreditCostCeil(inputTokens, env.aiInputCreditPer1kTokens);
  const outputCost = tokensToCreditCostCeil(outputTokens, env.aiOutputCreditPer1kTokens);

  const scaledInt = Number(
    new Decimal(inputCost)
      .plus(outputCost)
      .mul(new Decimal(multiplier))
      .toDecimalPlaces(0, Decimal.ROUND_CEIL),
  );
  const finalCost = Math.max(minCost, scaledInt);

  return {
    billingMode: input.billingMode,
    inputTokens,
    outputTokens,
    inputCost,
    outputCost,
    multiplier,
    minCost,
    finalCost,
  };
}

export function buildBillingLedgerDescription(quote: BillingModeQuote, extra?: string): string {
  const base =
    `AI 扣费 direction=DEBIT billingMode=${quote.billingMode} ` +
    `inputTokens=${quote.inputTokens} outputTokens=${quote.outputTokens} ` +
    `inputCost=${quote.inputCost} outputCost=${quote.outputCost} ` +
    `multiplier=${quote.multiplier} minCost=${quote.minCost} finalCost=${quote.finalCost}`;
  return extra ? `${base} ${extra}` : base;
}

export function minCostForBillingMode(mode: BillingModeValue): number {
  return modeParams(mode).minCost;
}

type AgentRunBudget = {
  agentRunId: string;
  organizationId: string;
  userId: string;
  spent: number;
  steps: number;
};

const agentRuns = new Map<string, AgentRunBudget>();

export function beginOrGetAgentRun(input: {
  agentRunId: string;
  organizationId: string;
  userId: string;
}): AgentRunBudget {
  const id = input.agentRunId.trim();
  if (!id) {
    throw new AppError(400, 'agentRunId 不能为空', 'INVALID_AGENT_RUN_ID');
  }
  const existing = agentRuns.get(id);
  if (existing) {
    if (
      existing.organizationId !== input.organizationId ||
      existing.userId !== input.userId
    ) {
      throw new AppError(403, 'Agent 任务归属不匹配', 'AGENT_RUN_MISMATCH');
    }
    return existing;
  }
  const created: AgentRunBudget = {
    agentRunId: id,
    organizationId: input.organizationId,
    userId: input.userId,
    spent: 0,
    steps: 0,
  };
  agentRuns.set(id, created);
  return created;
}

export function assertAgentRunCanContinue(agentRunId: string): AgentRunBudget {
  const run = agentRuns.get(agentRunId.trim());
  if (!run) {
    throw new AppError(400, 'Agent 任务不存在', 'AGENT_RUN_NOT_FOUND');
  }
  if (run.spent >= env.aiAgentMaxCreditPerRun) {
    throw new AppError(
      402,
      '本任务 AI 积分已达上限，请新建任务继续',
      'AGENT_CREDIT_LIMIT_REACHED',
    );
  }
  if (run.steps >= env.aiAgentMaxSteps) {
    throw new AppError(
      409,
      '本任务步骤已达上限，请确认后开启新任务继续',
      'AGENT_STEP_LIMIT_REACHED',
    );
  }
  const remaining = env.aiAgentMaxCreditPerRun - run.spent;
  if (remaining < env.aiAgentMinCreditCost) {
    throw new AppError(
      402,
      '本任务剩余 AI 积分不足以继续执行',
      'AGENT_CREDIT_LIMIT_REACHED',
    );
  }
  return run;
}

export function recordAgentRunCharge(agentRunId: string, finalCost: number): AgentRunBudget {
  const run = agentRuns.get(agentRunId.trim());
  if (!run) {
    throw new AppError(400, 'Agent 任务不存在', 'AGENT_RUN_NOT_FOUND');
  }
  run.spent += toNonNegInt(finalCost, 'finalCost');
  run.steps += 1;
  agentRuns.set(run.agentRunId, run);
  return run;
}

export function resetAgentRunBudgetsForTests(): void {
  agentRuns.clear();
}
