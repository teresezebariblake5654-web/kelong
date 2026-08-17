import { Request, Response, NextFunction } from 'express';
import { billingService } from '../services/billing.service';

export const userController = {
  async getCredits(req: Request, res: Response, next: NextFunction) {
    try {
      const credits = await billingService.getUserCredits(req.user!.id);
      res.json({ success: true, data: { credits } });
    } catch (error) {
      next(error);
    }
  },
};
