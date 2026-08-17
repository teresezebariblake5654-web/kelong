import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export type AccessTokenPayload = {
  sub: string;
  typ: 'access';
  role: string;
  jti: string;
};

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function createRawRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

export function createFamilyId(): string {
  return crypto.randomUUID();
}

export function signAccessToken(userId: string, role: string): {
  accessToken: string;
  expiresIn: string;
  jti: string;
} {
  const jti = crypto.randomUUID();
  const accessToken = jwt.sign(
    {
      sub: userId,
      typ: 'access',
      role,
      jti,
    } satisfies AccessTokenPayload,
    env.jwtAccessSecret,
    { expiresIn: env.jwtAccessTtl } as jwt.SignOptions,
  );

  return { accessToken, expiresIn: env.jwtAccessTtl, jti };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.jwtAccessSecret);
  if (typeof decoded === 'string' || decoded.typ !== 'access' || typeof decoded.sub !== 'string') {
    throw new Error('Invalid access token');
  }

  return {
    sub: decoded.sub,
    typ: 'access',
    role: String(decoded.role ?? 'user'),
    jti: String(decoded.jti ?? ''),
  };
}

export function refreshExpiryDate(): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + env.refreshTokenTtlDays);
  return expiresAt;
}
