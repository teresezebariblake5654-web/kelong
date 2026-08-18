import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
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

/** IPv6-safe key: prefer user id; otherwise official ipKeyGenerator. */
export function userOrIpKey(req: Request): string {
  const userId = req.user?.id?.trim();
  if (userId) return `user:${userId}`;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  try {
    return `ip:${ipKeyGenerator(ip)}`;
  } catch {
    return `ip:${ip}`;
  }
}

function buildLimiter(opts: {
  windowMs: number;
  max: number;
  keyGenerator?: typeof userOrIpKey;
}): RequestHandler {
  // Only construct express-rate-limit when enabled — avoids IPv6 validation noise at boot
  // when RATE_LIMIT_ENABLED=false.
  if (!env.rateLimitEnabled) {
    return passthrough;
  }
  return rateLimit({
    windowMs: opts.windowMs,
    max: opts.max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(opts.keyGenerator ? { keyGenerator: opts.keyGenerator } : {}),
    message: RATE_LIMITED_BODY,
  });
}

export const authRateLimiter = withRateLimitGate(
  buildLimiter({
    windowMs: env.authRateLimitWindowMs,
    max: env.authRateLimitMax,
  }),
);

export const aiRateLimiter = withRateLimitGate(
  buildLimiter({
    windowMs: env.aiRateLimitWindowMs,
    max: env.aiRateLimitMax,
    keyGenerator: userOrIpKey,
  }),
);

export const chatRateLimiter = withRateLimitGate(
  buildLimiter({
    windowMs: env.chatRateLimitWindowMs,
    max: env.chatRateLimitMax,
    keyGenerator: userOrIpKey,
  }),
);

export const feedbackRateLimiter = withRateLimitGate(
  buildLimiter({
    windowMs: env.feedbackRateLimitWindowMs,
    max: env.feedbackRateLimitMax,
    keyGenerator: userOrIpKey,
  }),
);

export const uploadRateLimiter = withRateLimitGate(
  buildLimiter({
    windowMs: env.uploadRateLimitWindowMs,
    max: env.uploadRateLimitMax,
    keyGenerator: userOrIpKey,
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
