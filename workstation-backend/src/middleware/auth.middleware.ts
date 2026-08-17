import { Request, Response, NextFunction } from 'express';
import { authService, AuthUser } from '../services/auth.service';
import { organizationService } from '../services/organization.service';
import { AppError } from '../utils/errors';
import { OrgRole } from '../utils/orgRoles';

export type OrgContext = {
  organizationId: string;
  role: string;
  membershipId: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      org?: OrgContext;
    }
  }
}

/** Alias kept for clarity in new code. */
export const requireAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      next(new AppError(401, '请先登录', 'UNAUTHORIZED'));
      return;
    }
    const token = header.slice(7).trim();
    if (!token) {
      next(new AppError(401, '请先登录', 'UNAUTHORIZED'));
      return;
    }
    req.user = await authService.getUserFromAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
};

/** @deprecated use requireAuth */
export const authMiddleware = requireAuth;

export async function requireOrganization(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(new AppError(401, '请先登录', 'UNAUTHORIZED'));
      return;
    }

    const organizationId =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id']) ||
      (typeof req.params.orgId === 'string' && req.params.orgId) ||
      '';

    if (!organizationId) {
      next(new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED'));
      return;
    }

    // Reject client attempts to spoof org via body.
    if (req.body && typeof req.body === 'object' && 'organizationId' in req.body) {
      delete (req.body as Record<string, unknown>).organizationId;
    }

    const membership = await organizationService.requireMembership(req.user.id, organizationId);
    req.org = {
      organizationId: membership.organizationId,
      role: membership.role,
      membershipId: membership.id,
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireOrganizationRole(minRole: OrgRole) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!req.org) {
        next(new AppError(400, '缺少组织上下文', 'ORGANIZATION_REQUIRED'));
        return;
      }
      organizationService.assertMinRole(req.org.role, minRole);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export async function requireSystemAdmin(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(new AppError(401, '请先登录', 'UNAUTHORIZED'));
      return;
    }
    if (req.user.role !== 'admin' && req.user.role !== 'platform_admin') {
      next(new AppError(403, '需要系统管理员权限', 'FORBIDDEN'));
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

/** @deprecated use requireSystemAdmin */
export const adminMiddleware = requireSystemAdmin;
