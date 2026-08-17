import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const RATE_LIMITED_BODY = {
  success: false,
  code: 'RATE_LIMITED',
  message: '请求过于频繁，请稍后重试',
} as const;

function passthrough(_req: Request, _res: Response, next: NextFunction): void {
  next();
}

function withRateLimitGate(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (!env.rateLimitEnabled) {
      passthrough(req, res, next);
      return;
    }
    return handler(req, res, next);
  };
}

function userOrIpKey(req: Request): string {
  const userId = req.user?.id?.trim();
  if (userId) return `user:${userId}`;
  return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
}

export const authRateLimiter = withRateLimitGate(
  rateLimit({
    windowMs: env.authRateLimitWindowMs,
    max: env.authRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: RATE_LIMITED_BODY,
  }),
);

export const aiRateLimiter = withRateLimitGate(
  rateLimit({
    windowMs: env.aiRateLimitWindowMs,
    max: env.aiRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userOrIpKey,
    message: RATE_LIMITED_BODY,
  }),
);

export const chatRateLimiter = withRateLimitGate(
  rateLimit({
    windowMs: env.chatRateLimitWindowMs,
    max: env.chatRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userOrIpKey,
    message: RATE_LIMITED_BODY,
  }),
);

export const feedbackRateLimiter = withRateLimitGate(
  rateLimit({
    windowMs: env.feedbackRateLimitWindowMs,
    max: env.feedbackRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userOrIpKey,
    message: RATE_LIMITED_BODY,
  }),
);

export const uploadRateLimiter = withRateLimitGate(
  rateLimit({
    windowMs: env.uploadRateLimitWindowMs,
    max: env.uploadRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userOrIpKey,
    message: RATE_LIMITED_BODY,
  }),
);

/** Per-user in-flight AI request limiter (not express-rate-limit). */
const aiInFlightByUser = new Map<string, number>();

export const aiConcurrencyLimiter: RequestHandler = (req, res, next) => {
  if (!env.rateLimitEnabled) {
    next();
    return;
  }

  const userId = req.user?.id?.trim();
  if (!userId) {
    next();
    return;
  }

  const current = aiInFlightByUser.get(userId) ?? 0;
  if (current >= env.aiConcurrencyLimit) {
    res.status(429).json(RATE_LIMITED_BODY);
    return;
  }

  aiInFlightByUser.set(userId, current + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const nextCount = (aiInFlightByUser.get(userId) ?? 1) - 1;
    if (nextCount <= 0) aiInFlightByUser.delete(userId);
    else aiInFlightByUser.set(userId, nextCount);
  };

  res.on('finish', release);
  res.on('close', release);
  next();
};
