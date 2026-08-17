import { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env';

export function getClientMeta(req: Request): { ip?: string; userAgent?: string } {
  const forwarded = req.headers['x-forwarded-for'];
  const ip =
    typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : req.socket.remoteAddress ?? undefined;

  return {
    ip,
    userAgent: req.get('user-agent') ?? undefined,
  };
}

export function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    domain: env.cookieDomain,
    // Shared by /api/auth/* and /api/v1/auth/*
    path: '/api',
    maxAge: env.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  };
}

export function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(env.refreshCookieName, refreshToken, refreshCookieOptions());
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(env.refreshCookieName, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    domain: env.cookieDomain,
    path: '/api',
  });
}

export function readRefreshToken(req: Request): string | undefined {
  const fromCookie = req.cookies?.[env.refreshCookieName];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) {
    return fromCookie;
  }

  // Allow body fallback for non-browser clients / tests.
  const fromBody = req.body?.refreshToken;
  return typeof fromBody === 'string' && fromBody.length > 0 ? fromBody : undefined;
}
