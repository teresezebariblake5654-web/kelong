import { Prisma, ProductType } from '@prisma/client';
import Ajv from 'ajv';
import { createHash } from 'crypto';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { getActiveLlmModel, getLlmProvider } from '../providers/llm';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import {
  assertBalanceForBillingMode,
  consumeAiCreditsByMode,
} from './aiCreditConsume.service';
import { BillingMode } from './aiBillingMode';
import { orgCreditService } from './orgCredit.service';

type PricingConfig = {
  model?: string;
  baseCredits?: number;
  inputCreditsPer1000Tokens?: number;
  outputCreditsPer1000Tokens?: number;
  inputCostMicrosPerMillionTokens?: number;
  outputCostMicrosPerMillionTokens?: number;
  maxOutputTokens?: number;
};

export type ExecuteAiTaskInput = {
  userId: string;
  organizationId: string;
  taskCode: string;
  templateVersion: string;
  structuredInput: Record<string, unknown>;
  requestId: string;
};

const DEV_LICENSE_MARKER = 'dev-internal-ai-license';

function asPricingConfig(value: Prisma.JsonValue): PricingConfig {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  const object = value as Record<string, unknown>;
  const number = (key: string) =>
    typeof object[key] === 'number' && Number.isFinite(object[key])
      ? Number(object[key])
      : undefined;
  return {
    model: typeof object.model === 'string' ? object.model : undefined,
    baseCredits: number('baseCredits'),
    inputCreditsPer1000Tokens: number('inputCreditsPer1000Tokens'),
    outputCreditsPer1000Tokens: number('outputCreditsPer1000Tokens'),
    inputCostMicrosPerMillionTokens: number('inputCostMicrosPerMillionTokens'),
    outputCostMicrosPerMillionTokens: number('outputCostMicrosPerMillionTokens'),
    maxOutputTokens: number('maxOutputTokens'),
  };
}

const ajv = new Ajv({ allErrors: true, strict: false });

function validateJsonSchema(
  schema: Prisma.JsonValue,
  data: unknown,
  code: 'INVALID_STRUCTURED_DATA' | 'INVALID_LLM_OUTPUT',
): void {
  if (!schema || Array.isArray(schema) || typeof schema !== 'object') {
    throw new AppError(500, '任务模板 JSON Schema 配置无效', 'INVALID_TEMPLATE_SCHEMA');
  }
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch {
    throw new AppError(500, '任务模板 JSON Schema 无法编译', 'INVALID_TEMPLATE_SCHEMA');
  }
  if (!validate(data)) {
    throw new AppError(
      code === 'INVALID_STRUCTURED_DATA' ? 422 : 502,
      code === 'INVALID_STRUCTURED_DATA' ? '结构化数据不符合任务要求' : '模型输出结构不符合任务要求',
      code,
    );
  }
}

function selectedModel(config: PricingConfig): string {
  if (config.model && config.model !== 'mock-task-model') return config.model;
  return getActiveLlmModel();
}

function calculateProviderCostMicros(
  config: PricingConfig,
  inputTokens: number,
  outputTokens: number,
): bigint {
  const inputRate = BigInt(Math.max(0, Math.floor(config.inputCostMicrosPerMillionTokens ?? 0)));
  const outputRate = BigInt(
    Math.max(0, Math.floor(config.outputCostMicrosPerMillionTokens ?? 0)),
  );
  const million = 1_000_000n;
  return (
    (BigInt(inputTokens) * inputRate + million - 1n) / million +
    (BigInt(outputTokens) * outputRate + million - 1n) / million
  );
}

function productAllowsTask(licenseType: ProductType, taskType: ProductType): boolean {
  return licenseType === 'UNIVERSAL_AGENT' || licenseType === taskType;
}

/**
 * AiUsage still requires a License FK. This internal row is ONLY for FK / product gating.
 * User-facing deduction goes to Organization CreditAccount (aligned with /api/v1/credits).
 * Production: wallet balance stays 0 — never seed infinite credits.
 */
async function ensureInternalLicense(): Promise<{ id: string; productType: ProductType }> {
  const hash = createHash('sha256').update(DEV_LICENSE_MARKER).digest('hex');
  const walletGrant = env.isProduction ? 0 : 100_000;
  const existing = await prisma.license.findFirst({
    where: { licenseCodeHash: hash },
  });
  if (existing) {
    if (existing.status !== 'ACTIVE') {
      await prisma.license.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE' },
      });
    }
    const wallet = await prisma.creditWallet.findUnique({ where: { licenseId: existing.id } });
    if (!wallet) {
      await prisma.creditWallet.create({
        data: { licenseId: existing.id, balance: walletGrant, totalGranted: walletGrant },
      });
    } else if (env.isProduction && wallet.balance > 0) {
      logger.warn('internal AI license wallet reset for production FK-only use', {
        licenseId: existing.id,
      });
      await prisma.creditWallet.update({
        where: { licenseId: existing.id },
        data: { balance: 0, reservedBalance: 0, totalGranted: 0 },
      });
    }
    return { id: existing.id, productType: existing.productType };
  }

  const created = await prisma.license.create({
    data: {
      licenseCodeHash: hash,
      productType: 'UNIVERSAL_AGENT',
      status: 'ACTIVE',
      wallet: { create: { balance: walletGrant, totalGranted: walletGrant } },
      deviceBindings: {
        create: {
          usbFingerprintHash: createHash('sha256').update(`${DEV_LICENSE_MARKER}:usb`).digest('hex'),
          deviceFingerprintHash: createHash('sha256')
            .update(`${DEV_LICENSE_MARKER}:device`)
            .digest('hex'),
          deviceName: 'internal-ai-fk',
        },
      },
    },
  });
  return { id: created.id, productType: created.productType };
}

export const aiTaskExecutionService = {
  async execute(input: ExecuteAiTaskInput) {
    if (!input.taskCode.trim() || !input.templateVersion.trim() || !input.requestId.trim()) {
      throw new AppError(
        400,
        'taskCode、templateVersion 和 requestId 不能为空',
        'INVALID_TASK_REQUEST',
      );
    }
    if (!input.userId || !input.organizationId) {
      throw new AppError(401, '缺少用户或组织上下文', 'UNAUTHORIZED');
    }

    const inputBytes = Buffer.byteLength(JSON.stringify(input.structuredInput), 'utf8');
    if (inputBytes > env.aiMaxInputBytes) {
      throw new AppError(413, '结构化数据超过允许大小', 'AI_INPUT_TOO_LARGE');
    }

    const existing = await prisma.aiUsage.findUnique({ where: { requestId: input.requestId } });
    if (existing) {
      return { usage: existing, result: existing.result ?? null, idempotent: true };
    }

    const template = await prisma.taskTemplate.findFirst({
      where: {
        code: input.taskCode,
        version: input.templateVersion,
        enabled: true,
      },
    });
    if (!template) {
      throw new AppError(404, '任务模板不存在或未启用', 'TASK_TEMPLATE_NOT_FOUND');
    }
    if (template.creditCost <= 0) {
      throw new AppError(500, '任务模板额度配置无效', 'INVALID_TASK_CREDIT_COST');
    }
    validateJsonSchema(template.inputSchema, input.structuredInput, 'INVALID_STRUCTURED_DATA');

    const internalLicense = await ensureInternalLicense();
    if (env.licenseEnforcementEnabled) {
      if (!productAllowsTask(internalLicense.productType, template.agentType)) {
        throw new AppError(403, '当前产品不支持此任务', 'TASK_PRODUCT_MISMATCH');
      }
    }

    const enforceCredits = env.licenseEnforcementEnabled;
    const billingMode = BillingMode.Workflow;
    if (enforceCredits) {
      await orgCreditService.ensureAccount(input.organizationId);
      await assertBalanceForBillingMode(input.organizationId, billingMode);
    }

    const config = asPricingConfig(template.modelConfig);
    const model = selectedModel(config);
    let usage;
    try {
      usage = await prisma.aiUsage.create({
        data: {
          licenseId: internalLicense.id,
          taskType: template.code,
          templateVersion: template.version,
          provider: env.modelProvider,
          model,
          creditsReserved: enforceCredits ? env.aiWorkflowMinCreditCost : 0,
          status: 'PENDING',
          requestId: input.requestId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await prisma.aiUsage.findUniqueOrThrow({
          where: { requestId: input.requestId },
        });
        return { usage: duplicate, result: duplicate.result ?? null, idempotent: true };
      }
      throw error;
    }

    try {
      await prisma.aiUsage.update({
        where: { id: usage.id },
        data: { status: 'PROCESSING' },
      });

      const result = await getLlmProvider().analyze({
        systemPrompt: template.promptTemplate,
        structuredData: input.structuredInput,
        model,
        maxOutputTokens: Math.min(
          env.aiMaxOutputTokens,
          Math.max(1, Math.floor(config.maxOutputTokens ?? env.aiMaxOutputTokens)),
        ),
      });
      validateJsonSchema(template.outputSchema, result.output, 'INVALID_LLM_OUTPUT');

      const providerCostMicros = calculateProviderCostMicros(
        config,
        result.inputTokens,
        result.outputTokens,
      );

      let charged = 0;
      if (enforceCredits) {
        try {
          const debit = await consumeAiCreditsByMode({
            organizationId: input.organizationId,
            userId: input.userId,
            requestId: input.requestId,
            billingMode,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            taskId: usage.id,
            descriptionExtra: `任务=${template.code}`,
          });
          charged = debit.finalCost;
        } catch (billingError) {
          await prisma.aiUsage.update({
            where: { id: usage.id },
            data: {
              status: 'FAILED',
              errorCode: 'BILLING_FAILED_AFTER_LLM',
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              providerCostMicros,
              completedAt: new Date(),
            },
          });
          if (billingError instanceof AppError && billingError.statusCode === 402) {
            throw new AppError(402, billingError.message, 'INSUFFICIENT_CREDITS');
          }
          throw billingError;
        }
      }

      const completed = await prisma.aiUsage.update({
        where: { id: usage.id },
        data: {
          provider: result.provider,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          providerCostMicros,
          creditsCharged: charged,
          status: 'COMPLETED',
          result: result.output as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      return { usage: completed, result: result.output, idempotent: false };
    } catch (error) {
      // Preserve billing-specific error code; LLM failures get their own codes.
      const current = await prisma.aiUsage.findUnique({ where: { id: usage.id } });
      if (current?.errorCode === 'BILLING_FAILED_AFTER_LLM') {
        throw error;
      }
      const errorCode = error instanceof AppError ? error.code : 'AI_TASK_FAILED';
      await prisma.aiUsage.update({
        where: { id: usage.id },
        data: {
          status: 'FAILED',
          errorCode,
          completedAt: new Date(),
        },
      });
      throw error;
    }
  },

  async getTask(_organizationId: string, taskId: string) {
    const usage = await prisma.aiUsage.findFirst({
      where: { id: taskId },
    });
    if (!usage) {
      throw new AppError(404, 'AI 任务不存在', 'AI_TASK_NOT_FOUND');
    }
    return usage;
  },
};
