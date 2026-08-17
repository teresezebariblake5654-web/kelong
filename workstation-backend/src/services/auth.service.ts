import bcrypt from 'bcrypt';
import { User } from '@prisma/client';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../utils/errors';
import { organizationService } from './organization.service';
import {
  createFamilyId,
  createRawRefreshToken,
  hashToken,
  refreshExpiryDate,
  signAccessToken,
  verifyAccessToken,
} from './token.service';

export const DEMO_USER_ID = 'demo_user';

export type AuthUser = Pick<
  User,
  'id' | 'username' | 'email' | 'phone' | 'role' | 'vipLevel' | 'credits' | 'status' | 'avatarUrl'
>;

export type AuthSession = {
  accessToken: string;
  expiresIn: string;
  user: AuthUser;
  refreshToken: string;
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
  }>;
};

const INVALID_CREDENTIALS = '邮箱或密码错误';

function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    role: user.role,
    vipLevel: user.vipLevel,
    credits: user.credits,
    status: user.status,
    avatarUrl: user.avatarUrl,
  };
}

function assertActive(user: User): void {
  if (user.status !== 'active') {
    throw new AppError(403, '账号已被禁用', 'ACCOUNT_DISABLED');
  }
}

async function attachOrganizations(userId: string) {
  const list = await organizationService.listForUser(userId);
  return list.map((item) => ({
    id: item.id,
    name: item.name,
    slug: item.slug,
    role: item.role,
  }));
}

async function issueSession(
  user: User,
  meta: { ip?: string; userAgent?: string },
  familyId?: string,
): Promise<AuthSession> {
  const { accessToken, expiresIn } = signAccessToken(user.id, user.role);
  const rawRefreshToken = createRawRefreshToken();
  const tokenHash = hashToken(rawRefreshToken);
  const resolvedFamilyId = familyId ?? createFamilyId();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      familyId: resolvedFamilyId,
      expiresAt: refreshExpiryDate(),
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  });

  return {
    accessToken,
    expiresIn,
    refreshToken: rawRefreshToken,
    user: toAuthUser(user),
    organizations: await attachOrganizations(user.id),
  };
}

export const authService = {
  toAuthUser,

  async register(
    input: { email: string; username: string; password: string; organizationName?: string },
    meta: { ip?: string; userAgent?: string } = {},
  ): Promise<AuthSession> {
    const email = input.email.trim().toLowerCase();
    const username = input.username.trim();

    if (!email || !username || input.password.length < 8) {
      throw new AppError(400, '请提供有效的邮箱、用户名和至少 8 位密码', 'BAD_REQUEST');
    }

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });

    if (existing) {
      throw new AppError(409, '邮箱或用户名已存在', 'USER_EXISTS');
    }

    const passwordHash = await bcrypt.hash(input.password, env.bcryptRounds);
    const user = await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        role: 'user',
        vipLevel: 'free',
        credits: env.defaultUserCredits,
        status: 'active',
      },
    });

    const org = await organizationService.createDefaultOrganizationForUser(user.id, username);
    if (input.organizationName?.trim()) {
      await prisma.organization.update({
        where: { id: org.id },
        data: { name: input.organizationName.trim() },
      });
    }

    // Phase 2: idempotent guarantee (org create already ensures; safe if race/partial).
    const { ensureCreditAccount } = await import('./creditAccount.service');
    await ensureCreditAccount(user.id);

    return issueSession(user, meta);
  },

  /** Register after email OTP verification (腾讯云发信). */
  async registerWithEmailOtp(
    input: {
      email: string;
      username: string;
      password: string;
      code: string;
      organizationName?: string;
    },
    meta: { ip?: string; userAgent?: string } = {},
  ): Promise<AuthSession> {
    const { emailOtpService, EmailOtpPurpose } = await import('./emailOtp.service');
    await emailOtpService.consume({
      email: input.email,
      purpose: EmailOtpPurpose.Register,
      code: input.code,
    });
    return this.register(
      {
        email: input.email,
        username: input.username,
        password: input.password,
        organizationName: input.organizationName,
      },
      meta,
    );
  },

  /** Passwordless login via email OTP (user must already exist). */
  async loginWithEmailOtp(
    input: { email: string; code: string },
    meta: { ip?: string; userAgent?: string } = {},
  ): Promise<AuthSession> {
    const email = input.email.trim().toLowerCase();
    const { emailOtpService, EmailOtpPurpose } = await import('./emailOtp.service');
    await emailOtpService.consume({
      email,
      purpose: EmailOtpPurpose.Login,
      code: input.code,
    });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AppError(404, '该邮箱尚未注册', 'USER_NOT_FOUND');
    }
    assertActive(user);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return issueSession(user, meta);
  },

  async login(
    input: { email: string; password: string },
    meta: { ip?: string; userAgent?: string } = {},
  ): Promise<AuthSession> {
    const email = input.email.trim().toLowerCase();
    if (!env.allowDemoUser && (email === 'demo@example.com' || email === 'demo')) {
      throw new AppError(403, '演示账号已在生产环境禁用', 'DEMO_USER_DISABLED');
    }
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      await bcrypt.compare(
        input.password,
        '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
      );
      throw new AppError(401, INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
    }

    if (!env.allowDemoUser && user.id === DEMO_USER_ID) {
      throw new AppError(403, '演示账号已在生产环境禁用', 'DEMO_USER_DISABLED');
    }

    const matched = await bcrypt.compare(input.password, user.passwordHash);
    if (!matched) {
      throw new AppError(401, INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
    }

    assertActive(user);

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const orgs = await organizationService.listForUser(user.id);
    if (orgs.length === 0) {
      await organizationService.createDefaultOrganizationForUser(user.id, user.username);
    }

    // Phase 2: guarantee CreditAccount exists for login session orgs (zero balance, no ledger).
    const { ensureCreditAccount } = await import('./creditAccount.service');
    await ensureCreditAccount(user.id);

    return issueSession(user, meta);
  },

  async refresh(
    rawRefreshToken: string | undefined,
    meta: { ip?: string; userAgent?: string } = {},
  ): Promise<AuthSession> {
    if (!rawRefreshToken) {
      throw new AppError(401, '未提供刷新凭证', 'UNAUTHORIZED');
    }

    const tokenHash = hashToken(rawRefreshToken);
    const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing) {
      throw new AppError(401, '刷新凭证无效', 'UNAUTHORIZED');
    }

    if (existing.revokedAt) {
      await prisma.refreshToken.updateMany({
        where: {
          familyId: existing.familyId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      throw new AppError(401, '检测到刷新凭证重放，请重新登录', 'REFRESH_TOKEN_REUSE');
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      await prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
      throw new AppError(401, '刷新凭证已过期', 'UNAUTHORIZED');
    }

    const user = await prisma.user.findUnique({ where: { id: existing.userId } });
    if (!user) {
      throw new AppError(401, '刷新凭证无效', 'UNAUTHORIZED');
    }
    assertActive(user);

    const session = await issueSession(user, meta, existing.familyId);
    const newHash = hashToken(session.refreshToken);
    const replacement = await prisma.refreshToken.findUnique({ where: { tokenHash: newHash } });

    await prisma.refreshToken.update({
      where: { id: existing.id },
      data: {
        revokedAt: new Date(),
        replacedById: replacement?.id,
      },
    });

    return session;
  },

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;

    const tokenHash = hashToken(rawRefreshToken);
    const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing || existing.revokedAt) return;

    await prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
  },

  async logoutAll(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  async getUserFromAccessToken(accessToken: string): Promise<AuthUser> {
    let payload;
    try {
      payload = verifyAccessToken(accessToken);
    } catch {
      throw new AppError(401, '无效的 token', 'UNAUTHORIZED');
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new AppError(401, '无效的 token', 'UNAUTHORIZED');
    }
    assertActive(user);
    return toAuthUser(user);
  },

  listOrganizationsForUser(userId: string) {
    return organizationService.listForUser(userId);
  },

  async setAvatarUrl(userId: string, avatarUrl: string): Promise<AuthUser> {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });
    return toAuthUser(user);
  },
};
