import { CreditLedgerType, Prisma } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import {
  type BillingModeValue,
  buildBillingLedgerDescription,
  computeBillingModeCost,
  minCostForBillingMode,
} from './aiBillingMode';

/**
 * Phase 6 AI debit — schema has no AI_CONSUME enum / direction column.
 * Semantic markers live on sourceType + description; ledger type stays CONSUME.
 */
export const AI_CONSUME_SOURCE_TYPE = 'AI_CONSUME';
export const AI_CONSUME_DIRECTION = 'DEBIT';

const Decimal = Prisma.Decimal;

function toNonNegInt(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new AppError(400, `${label} 无效`, 'INVALID_CREDIT_AMOUNT');
  }
  return Math.trunc(value);
}

/**
 * Convert token count → credit cost using Decimal ceil math (no float mul/div).
 * cost = ceil(tokens * creditsPer1k / 1000)
 */
export function tokensToCreditCost(
  tokens: number,
  creditsPer1kTokens: number | string,
): number {
  const tokenInt = toNonNegInt(tokens, 'tokens');
  const rate = new Decimal(creditsPer1kTokens);
  if (rate.isNeg()) {
    throw new AppError(400, '额度费率无效', 'INVALID_CREDIT_RATE');
  }
  if (tokenInt === 0 || rate.isZero()) return 0;

  const raw = new Decimal(tokenInt).mul(rate).div(1000);
  // ROUND_CEIL = 2 (decimal.js)
  return Number(raw.toDecimalPlaces(0, Decimal.ROUND_CEIL));
}

/**
 * Read Phase 6 env rates and convert raw tokens → credit costs.
 */
export function convertTokenUsageToCreditCosts(
  inputTokens: number,
  outputTokens: number,
  overrides?: {
    inputCreditPer1k?: number;
    outputCreditPer1k?: number;
    minCost?: number;
  },
): { input: number; output: number; minCost: number } {
  const inputRate = overrides?.inputCreditPer1k ?? env.aiInputCreditPer1kTokens;
  const outputRate = overrides?.outputCreditPer1k ?? env.aiOutputCreditPer1kTokens;
  const minCost = toNonNegInt(
    overrides?.minCost ?? env.aiChatMinCreditCost ?? env.aiMinCreditCost,
    'minCost',
  );
  return {
    input: tokensToCreditCost(inputTokens, inputRate),
    output: tokensToCreditCost(outputTokens, outputRate),
    minCost,
  };
}

/**
 * finalCost = max(minCost, input + output)
 * input/output MUST already be credit costs (not raw tokens).
 */
export function computeFinalAiCost(minCost: number, input: number, output: number): number {
  const min = toNonNegInt(minCost, 'minCost');
  const inCost = toNonNegInt(input, 'input');
  const outCost = toNonNegInt(output, 'output');
  const sum = inCost + outCost;
  return sum > min ? sum : min;
}

function idempotencyKeyFor(requestId: string): string {
  return `ai_consume:${requestId}`;
}

function ledgerResultFromExisting(
  requestId: string,
  existing: {
    id: string;
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
  },
): ConsumeAiCreditsResult {
  return {
    requestId,
    finalCost: existing.amount,
    balanceBefore: existing.balanceBefore,
    balanceAfter: existing.balanceAfter,
    ledgerId: existing.id,
    direction: AI_CONSUME_DIRECTION,
    type: AI_CONSUME_SOURCE_TYPE,
    idempotent: true,
  };
}

export type ConsumeAiCreditsInput = {
  organizationId: string;
  userId: string;
  requestId: string;
  minCost: number;
  /** Input-side credit units (converted; not raw tokens). */
  input: number;
  /** Output-side credit units (converted; not raw tokens). */
  output: number;
  taskId?: string;
  description?: string;
  /** When set, debit exactly this amount (mode billing). */
  chargedAmount?: number;
};

export type ConsumeAiCreditsResult = {
  requestId: string;
  finalCost: number;
  balanceBefore: number;
  balanceAfter: number;
  ledgerId: string;
  direction: typeof AI_CONSUME_DIRECTION;
  type: typeof AI_CONSUME_SOURCE_TYPE;
  idempotent: boolean;
};

/**
 * Reject when org available balance is already exhausted.
 * Call before starting an AI request.
 */
export async function assertAiBalancePositive(organizationId: string): Promise<{
  balance: number;
  available: number;
}> {
  const account = await prisma.creditAccount.findUnique({
    where: { organizationId },
  });
  if (!account) {
    throw new AppError(404, '组织额度账户不存在', 'ORG_CREDIT_NOT_FOUND');
  }
  const available = account.balance - account.frozenBalance;
  if (account.balance <= 0 || available <= 0) {
    throw new AppError(402, 'AI 积分不足，请购买积分后继续使用。', 'INSUFFICIENT_CREDITS');
  }
  return { balance: account.balance, available };
}

/** Pre-flight: available must cover the mode minimum charge. */
export async function assertBalanceForBillingMode(
  organizationId: string,
  billingMode: BillingModeValue,
): Promise<{ balance: number; available: number; minCost: number }> {
  const minCost = minCostForBillingMode(billingMode);
  const { balance, available } = await assertAiBalancePositive(organizationId);
  if (available < minCost) {
    throw new AppError(402, 'AI 积分不足，请购买积分后继续使用。', 'INSUFFICIENT_CREDITS');
  }
  return { balance, available, minCost };
}

async function findAiConsumeLedger(
  tx: Prisma.TransactionClient | typeof prisma,
  requestId: string,
  key: string,
) {
  return tx.creditLedger.findFirst({
    where: {
      OR: [
        { sourceType: AI_CONSUME_SOURCE_TYPE, sourceId: requestId },
        { idempotencyKey: key },
      ],
    },
  });
}

/**
 * Deduct credits after a successful AI request.
 * Idempotent on requestId via CreditLedger (sourceType+sourceId) and idempotencyKey.
 *
 * finalCost = max(minCost, input + output)
 * Ledger: type=CONSUME, sourceType=AI_CONSUME, direction=DEBIT (description)
 */
export async function consumeAiCredits(
  input: ConsumeAiCreditsInput,
): Promise<ConsumeAiCreditsResult> {
  const requestId = input.requestId.trim();
  if (!requestId) {
    throw new AppError(400, 'requestId 不能为空', 'INVALID_REQUEST_ID');
  }
  if (!input.organizationId || !input.userId) {
    throw new AppError(401, '缺少用户或组织上下文', 'UNAUTHORIZED');
  }

  const finalCost =
    input.chargedAmount != null
      ? toNonNegInt(input.chargedAmount, 'chargedAmount')
      : computeFinalAiCost(input.minCost, input.input, input.output);
  if (finalCost <= 0) {
    throw new AppError(400, '扣费金额无效', 'INVALID_CREDIT_AMOUNT');
  }

  const key = idempotencyKeyFor(requestId);

  const existing = await findAiConsumeLedger(prisma, requestId, key);
  if (existing) {
    return ledgerResultFromExisting(requestId, existing);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // Re-check under row lock path to avoid double-debit races.
      const dup = await findAiConsumeLedger(tx, requestId, key);
      if (dup) {
        return ledgerResultFromExisting(requestId, dup);
      }

      const locked = await tx.$queryRaw<
        Array<{
          balance: number;
          frozenBalance: number;
          totalConsumed: number;
        }>
      >`
        SELECT balance, "frozenBalance", "totalConsumed"
        FROM "CreditAccount"
        WHERE "organizationId" = ${input.organizationId}
        FOR UPDATE
      `;

      const row = locked[0];
      if (!row) {
        throw new AppError(404, '组织额度账户不存在', 'ORG_CREDIT_NOT_FOUND');
      }

      const balanceBefore = row.balance;
      const available = row.balance - row.frozenBalance;

      if (balanceBefore < finalCost || available < finalCost) {
        throw new AppError(402, 'AI 积分不足，请购买积分后继续使用。', 'INSUFFICIENT_CREDITS');
      }

      const balanceAfter = balanceBefore - finalCost;
      if (balanceAfter < 0) {
        throw new AppError(402, 'AI 积分不足，请购买积分后继续使用。', 'INSUFFICIENT_CREDITS');
      }

      // Atomic guard: never allow balance to go negative even under races.
      const affected = await tx.$executeRaw`
        UPDATE "CreditAccount"
        SET
          balance = balance - ${finalCost},
          "totalConsumed" = "totalConsumed" + ${finalCost},
          "updatedAt" = NOW()
        WHERE "organizationId" = ${input.organizationId}
          AND balance >= ${finalCost}
          AND (balance - "frozenBalance") >= ${finalCost}
      `;
      if (Number(affected) !== 1) {
        throw new AppError(402, 'AI 积分不足，请购买积分后继续使用。', 'INSUFFICIENT_CREDITS');
      }

      const description =
        input.description ??
        `AI 扣费 direction=${AI_CONSUME_DIRECTION} requestId=${requestId} cost=${finalCost} (min=${toNonNegInt(input.minCost, 'minCost')}, in=${toNonNegInt(input.input, 'input')}, out=${toNonNegInt(input.output, 'output')})`;

      const ledger = await tx.creditLedger.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId,
          taskId: input.taskId,
          type: CreditLedgerType.CONSUME,
          amount: finalCost,
          balanceBefore,
          balanceAfter,
          description,
          idempotencyKey: key,
          sourceType: AI_CONSUME_SOURCE_TYPE,
          sourceId: requestId,
        },
      });

      return {
        requestId,
        finalCost,
        balanceBefore,
        balanceAfter,
        ledgerId: ledger.id,
        direction: AI_CONSUME_DIRECTION,
        type: AI_CONSUME_SOURCE_TYPE,
        idempotent: false,
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const dup = await findAiConsumeLedger(prisma, requestId, key);
      if (dup) {
        return ledgerResultFromExisting(requestId, dup);
      }
    }
    throw error;
  }
}

/**
 * Mode-based debit after successful LLM call (idempotent on requestId).
 * Reuses the same CreditLedger transaction path as Phase 6.
 */
export async function consumeAiCreditsByMode(input: {
  organizationId: string;
  userId: string;
  requestId: string;
  billingMode: BillingModeValue;
  inputTokens: number;
  outputTokens: number;
  taskId?: string;
  descriptionExtra?: string;
}): Promise<ConsumeAiCreditsResult & { quote: ReturnType<typeof computeBillingModeCost> }> {
  const quote = computeBillingModeCost({
    billingMode: input.billingMode,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
  });
  const result = await consumeAiCredits({
    organizationId: input.organizationId,
    userId: input.userId,
    requestId: input.requestId,
    minCost: quote.minCost,
    input: quote.inputCost,
    output: quote.outputCost,
    chargedAmount: quote.finalCost,
    taskId: input.taskId,
    description: buildBillingLedgerDescription(quote, input.descriptionExtra),
  });
  return { ...result, quote };
}
