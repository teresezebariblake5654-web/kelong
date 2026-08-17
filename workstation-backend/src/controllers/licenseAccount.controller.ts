import { NextFunction, Request, Response } from 'express';
import { licenseAccountService } from '../services/licenseAccount.service';
import { AppError } from '../utils/errors';

function licenseIdFrom(req: Request): string {
  if (!req.license) {
    throw new AppError(401, '缺少 License 授权上下文', 'LICENSE_TOKEN_REQUIRED');
  }
  return req.license.licenseId;
}

function limitFrom(req: Request): number | undefined {
  if (typeof req.query.limit !== 'string') return undefined;
  const limit = Number(req.query.limit);
  return Number.isInteger(limit) ? limit : undefined;
}

export const licenseAccountController = {
  async wallet(req: Request, res: Response, next: NextFunction) {
    try {
      const wallet = await licenseAccountService.getWallet(licenseIdFrom(req));
      res.json({ success: true, data: wallet });
    } catch (error) {
      next(error);
    }
  },

  async transactions(req: Request, res: Response, next: NextFunction) {
    try {
      const transactions = await licenseAccountService.listTransactions(
        licenseIdFrom(req),
        limitFrom(req),
      );
      res.json({ success: true, data: transactions });
    } catch (error) {
      next(error);
    }
  },

  async usage(req: Request, res: Response, next: NextFunction) {
    try {
      const usage = await licenseAccountService.listUsage(
        licenseIdFrom(req),
        limitFrom(req),
      );
      res.json({ success: true, data: usage });
    } catch (error) {
      next(error);
    }
  },
};
