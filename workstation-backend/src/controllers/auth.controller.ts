import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { emailOtpService, EmailOtpPurpose } from '../services/emailOtp.service';
import { AppError } from '../utils/errors';
import {
  clearRefreshCookie,
  getClientMeta,
  readRefreshToken,
  setRefreshCookie,
} from '../utils/authCookies';

function publicSession(session: Awaited<ReturnType<typeof authService.login>>) {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresIn: session.expiresIn,
    user: session.user,
    organizations: session.organizations,
  };
}

export const authController = {
  async sendEmailOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, purpose } = req.body ?? {};
      if (!email || !purpose) {
        throw new AppError(400, '请提供 email 和 purpose（register|login）', 'BAD_REQUEST');
      }
      const normalized =
        String(purpose).toLowerCase() === 'login'
          ? EmailOtpPurpose.Login
          : String(purpose).toLowerCase() === 'register'
            ? EmailOtpPurpose.Register
            : null;
      if (!normalized) {
        throw new AppError(400, 'purpose 仅支持 register 或 login', 'INVALID_OTP_PURPOSE');
      }
      const data = await emailOtpService.send({
        email: String(email),
        purpose: normalized,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, username, password, code } = req.body ?? {};
      if (!email || !username || !password) {
        throw new AppError(400, '请提供 email、username、password', 'BAD_REQUEST');
      }
      if (!code || !String(code).trim()) {
        throw new AppError(400, '请先获取并填写邮箱验证码', 'OTP_REQUIRED');
      }

      const session = await authService.registerWithEmailOtp(
        {
          email: String(email),
          username: String(username),
          password: String(password),
          code: String(code).trim(),
        },
        getClientMeta(req),
      );
      setRefreshCookie(res, session.refreshToken);
      res.status(201).json({ success: true, data: publicSession(session) });
    } catch (error) {
      next(error);
    }
  },

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password, code } = req.body ?? {};
      if (!email) {
        throw new AppError(400, '请提供 email', 'BAD_REQUEST');
      }

      let session;
      if (code && !password) {
        session = await authService.loginWithEmailOtp(
          { email: String(email), code: String(code) },
          getClientMeta(req),
        );
      } else if (password) {
        session = await authService.login(
          { email: String(email), password: String(password) },
          getClientMeta(req),
        );
      } else {
        throw new AppError(400, '请提供 password 或验证码 code', 'BAD_REQUEST');
      }
      setRefreshCookie(res, session.refreshToken);
      res.json({ success: true, data: publicSession(session) });
    } catch (error) {
      next(error);
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const session = await authService.refresh(readRefreshToken(req), getClientMeta(req));
      setRefreshCookie(res, session.refreshToken);
      res.json({ success: true, data: publicSession(session) });
    } catch (error) {
      clearRefreshCookie(res);
      next(error);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      await authService.logout(readRefreshToken(req));
      clearRefreshCookie(res);
      res.json({ success: true, data: { ok: true } });
    } catch (error) {
      next(error);
    }
  },

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, '请先登录', 'UNAUTHORIZED');
      }
      const organizations = await authService.listOrganizationsForUser(req.user.id);
      res.json({
        success: true,
        data: {
          ...req.user,
          organizations,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async uploadAvatar(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, '请先登录', 'UNAUTHORIZED');
      }
      const file = req.file;
      if (!file?.filename) {
        throw new AppError(400, '请选择头像图片', 'AVATAR_REQUIRED');
      }
      const avatarUrl = `/static/avatars/${file.filename}`;
      const user = await authService.setAvatarUrl(req.user.id, avatarUrl);
      const organizations = await authService.listOrganizationsForUser(user.id);
      res.json({
        success: true,
        data: {
          ...user,
          organizations,
        },
      });
    } catch (error) {
      next(error);
    }
  },
};
