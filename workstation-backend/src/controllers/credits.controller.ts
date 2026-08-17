import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { creditAccountService } from '../services/creditAccount.service';
import { orgCreditService } from '../services/orgCredit.service';
import {
  assertBalanceForBillingMode,
  consumeAiCreditsByMode,
} from '../services/aiCreditConsume.service';
import { BillingMode } from '../services/aiBillingMode';
import { AppError } from '../utils/errors';

function requireOrg(req: Request) {
  if (!req.user) {
    throw new AppError(401, '请先登录', 'UNAUTHORIZED');
  }
  if (!req.org?.organizationId) {
    throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
  }
  return req.org.organizationId;
}

function nonNegInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}

export const creditsController = {
  async balance(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = requireOrg(req);
      const data = await orgCreditService.getBalance(organizationId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  /** Phase 2: summary with ensureCreditAccount safety net (no recharge / no AI). */
  async summary(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, '请先登录', 'UNAUTHORIZED');
      }
      const account = await creditAccountService.ensureCreditAccount(req.user.id);
      const organizationId = req.org?.organizationId ?? account.organizationId;
      const balanceView =
        organizationId === account.organizationId
          ? {
              balance: account.balance,
              frozenBalance: account.frozenBalance,
              availableBalance: Math.max(0, account.balance - account.frozenBalance),
            }
          : await orgCreditService.getBalance(organizationId);

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthly = await orgCreditService.sumConsumedSince(organizationId, monthStart);

      const availableBalance = balanceView.availableBalance;
      res.json({
        success: true,
        data: {
          organizationId,
          balance: balanceView.balance,
          frozenBalance: balanceView.frozenBalance,
          availableBalance,
          monthlyConsumed: monthly,
          totalRecharged: account.totalRecharged,
          totalConsumed: account.totalConsumed,
          lowBalance: availableBalance < env.creditLowBalanceThreshold,
          unit: 'credits' as const,
          updatedAt: account.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async ledger(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = requireOrg(req);
      const page = Number(req.query.page ?? 1);
      const pageSize = Number(req.query.pageSize ?? 20);
      const typeFilter =
        typeof req.query.type === 'string' && req.query.type.trim()
          ? req.query.type.trim()
          : undefined;
      const data = await orgCreditService.listLedger(organizationId, {
        page: Number.isFinite(page) ? page : 1,
        pageSize: Number.isFinite(pageSize) ? pageSize : 20,
        typeFilter,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Debit org credits for a local OpenClaw / Lobster chat turn.
   * Client runs the model locally, then reports usage here for billing.
   */
  async consumeChatTurn(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, '请先登录', 'UNAUTHORIZED');
      }
      const organizationId = requireOrg(req);
      const body = (req.body ?? {}) as {
        requestId?: string;
        conversationId?: string;
        agentCode?: string;
        inputTokens?: number;
        outputTokens?: number;
      };
      const requestId = String(body.requestId || '').trim() || randomUUID();
      const conversationId = String(body.conversationId || '').trim() || 'unknown';
      const agentCode = String(body.agentCode || '').trim() || 'general';
      const inputTokens = nonNegInt(body.inputTokens, 0);
      const outputTokens = nonNegInt(body.outputTokens, 0);

      if (!env.licenseEnforcementEnabled) {
        res.json({
          success: true,
          data: {
            chargedCredits: 0,
            billingRequestId: requestId,
            balanceAfter: null,
            skipped: true,
          },
        });
        return;
      }

      await orgCreditService.ensureAccount(organizationId, { userId: req.user.id });
      await assertBalanceForBillingMode(organizationId, BillingMode.Chat);

      const debit = await consumeAiCreditsByMode({
        organizationId,
        userId: req.user.id,
        requestId,
        billingMode: BillingMode.Chat,
        inputTokens,
        outputTokens,
        descriptionExtra: `lobster conversationId=${conversationId} agent=${agentCode}`,
      });

      res.json({
        success: true,
        data: {
          chargedCredits: debit.finalCost,
          billingRequestId: requestId,
          balanceAfter: debit.balanceAfter,
          skipped: false,
        },
      });
    } catch (error) {
      next(error);
    }
  },
};
