import { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/database';
import {
  LicenseAuthorization,
  verifyLicenseAccessToken,
} from '../services/licenseToken.service';
import { AppError } from '../utils/errors';

declare global {
  namespace Express {
    interface Request {
      license?: LicenseAuthorization;
    }
  }
}

function rejectClientLicenseId(req: Request): void {
  const bodyHasLicenseId =
    req.body && typeof req.body === 'object' && 'licenseId' in req.body;
  const queryHasLicenseId = 'licenseId' in req.query;
  const headerHasLicenseId = typeof req.headers['x-license-id'] === 'string';
  if (bodyHasLicenseId || queryHasLicenseId || headerHasLicenseId) {
    throw new AppError(
      400,
      'licenseId 只能由服务端从 License Token 解析',
      'CLIENT_LICENSE_ID_FORBIDDEN',
    );
  }
}

export async function licenseAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    rejectClientLicenseId(req);

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(401, '请提供 License Token', 'LICENSE_TOKEN_REQUIRED');
    }
    const token = header.slice(7).trim();
    if (!token) {
      throw new AppError(401, '请提供 License Token', 'LICENSE_TOKEN_REQUIRED');
    }

    let claims;
    try {
      claims = verifyLicenseAccessToken(token);
    } catch {
      throw new AppError(401, 'License Token 无效或已过期', 'INVALID_LICENSE_TOKEN');
    }

    const license = await prisma.license.findUnique({
      where: { id: claims.sub },
      include: {
        plan: true,
        deviceBindings: {
          where: { id: claims.deviceBindingId, revokedAt: null },
          take: 1,
        },
      },
    });
    if (!license || license.deviceBindings.length !== 1) {
      throw new AppError(401, 'License 或设备绑定无效', 'INVALID_LICENSE_CONTEXT');
    }
    if (license.status !== 'ACTIVE') {
      throw new AppError(403, 'License 当前不可用', `LICENSE_${license.status}`);
    }
    if (license.expiresAt && license.expiresAt <= new Date()) {
      throw new AppError(403, 'License 已过期', 'LICENSE_EXPIRED');
    }

    req.license = {
      licenseId: license.id,
      productType: license.productType,
      planCode: license.plan?.code,
      deviceBindingId: license.deviceBindings[0].id,
    };
    next();
  } catch (error) {
    next(error);
  }
}
