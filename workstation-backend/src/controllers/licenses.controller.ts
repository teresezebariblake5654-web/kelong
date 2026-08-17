import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { licenseService } from '../services/license.service';
import { AppError } from '../utils/errors';

const activateSchema = z
  .object({
    activationCode: z.string().trim().min(1).max(256),
    usbFingerprint: z.string().trim().min(1).max(512),
    deviceFingerprint: z.string().trim().min(1).max(512),
    deviceName: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

function licenseContext(req: Request) {
  if (!req.license) {
    throw new AppError(401, '缺少 License 授权上下文', 'LICENSE_TOKEN_REQUIRED');
  }
  return req.license;
}

export const licensesController = {
  async activate(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = activateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, '激活参数无效', 'INVALID_ACTIVATION_REQUEST');
      }
      const session = await licenseService.activate(parsed.data);
      res.json({ success: true, data: session });
    } catch (error) {
      next(error);
    }
  },

  async verify(req: Request, res: Response, next: NextFunction) {
    try {
      const current = await licenseService.getCurrent(licenseContext(req));
      res.json({ success: true, data: { valid: true, ...current } });
    } catch (error) {
      next(error);
    }
  },

  async heartbeat(req: Request, res: Response, next: NextFunction) {
    try {
      const heartbeat = await licenseService.heartbeat(licenseContext(req));
      res.json({ success: true, data: heartbeat });
    } catch (error) {
      next(error);
    }
  },

  async current(req: Request, res: Response, next: NextFunction) {
    try {
      const current = await licenseService.getCurrent(licenseContext(req));
      res.json({ success: true, data: current });
    } catch (error) {
      next(error);
    }
  },
};
