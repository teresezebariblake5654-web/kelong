import { Request, Response, NextFunction } from 'express';
import { organizationService } from '../services/organization.service';
import { AppError } from '../utils/errors';

export const organizationsController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await organizationService.listForUser(req.user!.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await organizationService.getByIdForUser(
        req.user!.id,
        String(req.params.orgId),
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await organizationService.listMembers(
        req.user!.id,
        String(req.params.orgId),
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async addMember(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, role } = req.body ?? {};
      if (!email || typeof email !== 'string') {
        throw new AppError(400, '请提供 email', 'BAD_REQUEST');
      }
      const data = await organizationService.addMember(
        req.user!.id,
        String(req.params.orgId),
        { email, role: typeof role === 'string' ? role : 'member' },
      );
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async updateMember(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = req.body ?? {};
      if (!role || typeof role !== 'string') {
        throw new AppError(400, '请提供 role', 'BAD_REQUEST');
      }
      const data = await organizationService.updateMemberRole(
        req.user!.id,
        String(req.params.orgId),
        String(req.params.memberId),
        role,
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async removeMember(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await organizationService.removeMember(
        req.user!.id,
        String(req.params.orgId),
        String(req.params.memberId),
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
