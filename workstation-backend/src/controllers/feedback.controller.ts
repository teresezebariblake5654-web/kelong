import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { submitFeedbackRecord } from '../services/feedback.service';
import { AppError } from '../utils/errors';

const feedbackSchema = z
  .object({
    category: z.string().trim().min(1).max(64),
    content: z.string().trim().min(4).max(4000),
    contact: z.string().trim().max(200).optional(),
    emailConsent: z.literal(true),
  })
  .strict();

async function tryAttachUser(req: Request): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return;
  const token = header.slice(7).trim();
  if (!token) return;
  try {
    req.user = await authService.getUserFromAccessToken(token);
  } catch {
    // Feedback remains public even if token is invalid.
  }
}

export const feedbackController = {
  async submit(req: Request, res: Response, next: NextFunction) {
    try {
      await tryAttachUser(req);

      const parsed = feedbackSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError(400, '请填写完整反馈内容，并勾选同意提交给客服', 'BAD_REQUEST');
      }

      const { category, content, contact } = parsed.data;
      const userLabel = req.user
        ? `${req.user.username || 'user'} <${req.user.email || req.user.id}>`
        : 'anonymous';

      const result = await submitFeedbackRecord({
        category,
        content,
        contact,
        emailConsent: true,
        userId: req.user?.id ?? null,
        userLabel,
      });

      // Never return the inbox address to the client.
      res.json({
        success: true,
        data: {
          id: result.id,
          delivered: result.delivered,
        },
      });
    } catch (error) {
      next(error);
    }
  },
};
