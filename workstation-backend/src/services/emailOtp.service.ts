import { createHash, randomInt } from 'crypto';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../utils/errors';
import { sendMail } from './mail.service';

export const EmailOtpPurpose = {
  Register: 'register',
  Login: 'login',
} as const;

export type EmailOtpPurposeValue = (typeof EmailOtpPurpose)[keyof typeof EmailOtpPurpose];

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashOtp(email: string, purpose: string, code: string): string {
  return createHash('sha256')
    .update(`${email}|${purpose}|${code}|${env.jwtAccessSecret}`)
    .digest('hex');
}

function generateCode(): string {
  return String(randomInt(100000, 999999));
}

export const emailOtpService = {
  async send(input: {
    email: string;
    purpose: EmailOtpPurposeValue;
  }): Promise<{ retryAfterSec: number; expiresInSec: number; mockCode?: string }> {
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email)) {
      throw new AppError(400, '请输入有效邮箱', 'INVALID_EMAIL');
    }
    if (
      input.purpose !== EmailOtpPurpose.Register &&
      input.purpose !== EmailOtpPurpose.Login
    ) {
      throw new AppError(400, '验证码用途无效', 'INVALID_OTP_PURPOSE');
    }

    if (input.purpose === EmailOtpPurpose.Register) {
      const exists = await prisma.user.findUnique({ where: { email } });
      if (exists) {
        throw new AppError(409, '该邮箱已注册，请直接登录', 'USER_EXISTS');
      }
    }
    if (input.purpose === EmailOtpPurpose.Login) {
      const exists = await prisma.user.findUnique({ where: { email } });
      if (!exists) {
        throw new AppError(404, '该邮箱尚未注册', 'USER_NOT_FOUND');
      }
    }

    const latest = await prisma.emailOtp.findFirst({
      where: { email, purpose: input.purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (latest) {
      const elapsedMs = Date.now() - latest.lastSentAt.getTime();
      const cooldownMs = env.emailOtpResendCooldownSec * 1000;
      if (elapsedMs < cooldownMs) {
        const retryAfterSec = Math.ceil((cooldownMs - elapsedMs) / 1000);
        throw new AppError(
          429,
          `发送太频繁，请 ${retryAfterSec} 秒后再试`,
          'OTP_RATE_LIMITED',
        );
      }
    }

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const sentToday = await prisma.emailOtp.count({
      where: {
        email,
        purpose: input.purpose,
        createdAt: { gte: dayStart },
      },
    });
    if (sentToday >= env.emailOtpDailyLimit) {
      throw new AppError(429, '今日验证码发送次数已达上限', 'OTP_DAILY_LIMIT');
    }

    const code = generateCode();
    const codeHash = hashOtp(email, input.purpose, code);
    const expiresAt = new Date(Date.now() + env.emailOtpTtlSec * 1000);

    await prisma.emailOtp.create({
      data: {
        email,
        purpose: input.purpose,
        codeHash,
        expiresAt,
        sendCount: 1,
        lastSentAt: new Date(),
      },
    });

    const purposeLabel = input.purpose === EmailOtpPurpose.Register ? '注册' : '登录';
    const minutes = Math.max(1, Math.floor(env.emailOtpTtlSec / 60));
    const text =
      `【${env.mailFromName || 'AI工作站'}】您的${purposeLabel}验证码是 ${code}，` +
      `${minutes} 分钟内有效。如非本人操作请忽略。`;

    try {
      if (env.mailProvider === 'ses-api') {
        const { sendOtpViaSesTemplate } = await import('./mail.service');
        // SES template variables must match console template: {{username}} {{verify_code}}
        await sendOtpViaSesTemplate({
          to: email,
          subject: `【${env.mailFromName || 'AI工作站'}】验证码 ${code}`,
          templateData: {
            username: '用户',
            verify_code: code,
          },
        });
      } else {
        await sendMail({
          to: email,
          subject: `${purposeLabel}验证码 - ${env.mailFromName || 'AI工作站'}`,
          text,
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const { logger } = await import('../utils/logger');
      logger.error('email_otp_send_failed', {
        email,
        purpose: input.purpose,
        provider: env.mailProvider,
        detail,
      });
      throw new AppError(
        502,
        '验证码邮件发送失败，请检查发信配置或稍后重试',
        'MAIL_SEND_FAILED',
      );
    }

    return {
      retryAfterSec: env.emailOtpResendCooldownSec,
      expiresInSec: env.emailOtpTtlSec,
      ...(env.mailProvider === 'mock' ? { mockCode: code } : {}),
    };
  },

  async consume(input: {
    email: string;
    purpose: EmailOtpPurposeValue;
    code: string;
  }): Promise<void> {
    const email = normalizeEmail(input.email);
    const code = String(input.code ?? '').trim();
    if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
      throw new AppError(400, '请输入有效邮箱和 6 位验证码', 'INVALID_OTP');
    }

    const latest = await prisma.emailOtp.findFirst({
      where: {
        email,
        purpose: input.purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest) {
      throw new AppError(400, '验证码无效或已过期，请重新获取', 'OTP_EXPIRED');
    }

    if (latest.attemptCount >= 5) {
      throw new AppError(429, '验证码尝试次数过多，请重新获取', 'OTP_TOO_MANY_ATTEMPTS');
    }

    const expected = hashOtp(email, input.purpose, code);
    if (expected !== latest.codeHash) {
      await prisma.emailOtp.update({
        where: { id: latest.id },
        data: { attemptCount: { increment: 1 } },
      });
      throw new AppError(400, '验证码错误', 'OTP_INVALID');
    }

    await prisma.emailOtp.update({
      where: { id: latest.id },
      data: { consumedAt: new Date() },
    });
  },
};
