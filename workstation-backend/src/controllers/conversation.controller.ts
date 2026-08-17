import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { conversationService } from '../services/conversation.service';
import { AppError } from '../utils/errors';

const agent = z.enum([
  'general',
  'data-analysis',
  'finance',
  'sales',
  'admin',
  'hr',
  'production',
  'logistics',
  'ecommerce',
]);
const visibility = z.enum(['private', 'organization']);
const create = z
  .object({
    agentCode: agent,
    title: z.string().trim().min(1).max(200).optional(),
    visibility: visibility.optional(),
  })
  .strict();
const update = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    visibility: visibility.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
const importedMessage = z
  .object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().max(32000),
    attachments: z.array(z.any()).max(10).optional(),
    status: z.enum(['completed', 'failed']).optional(),
    thinking: z.string().max(32000).optional(),
    generatedFiles: z.array(z.any()).max(20).optional(),
    createdAt: z.string().datetime().optional(),
  })
  .strict();
const importing = z
  .object({
    id: z.string().trim().min(1).max(100).optional(),
    title: z.string().trim().min(1).max(200),
    agentCode: agent,
    visibility: visibility.optional(),
    messages: z.array(importedMessage).max(1000),
  })
  .strict();

function context(req: Request) {
  if (!req.user || !req.org) throw new AppError(401, '请先登录', 'UNAUTHORIZED');
  return { organizationId: req.org.organizationId, userId: req.user.id };
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(400, '会话请求格式无效', 'INVALID_CONVERSATION_REQUEST');
  }
  return parsed.data;
}

function routeId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError(400, '会话 ID 无效', 'INVALID_CONVERSATION_ID');
  return id;
}

export const conversationController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = context(req);
      res.json({
        success: true,
        data: await conversationService.list(ctx.organizationId, ctx.userId),
      });
    } catch (error) {
      next(error);
    }
  },
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = context(req);
      const data = parse(create, req.body);
      res.status(201).json({
        success: true,
        data: await conversationService.create({ ...ctx, ...data }),
      });
    } catch (error) {
      next(error);
    }
  },
  async messages(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = context(req);
      res.json({
        success: true,
        data: await conversationService.getMessages(
          routeId(req),
          ctx.organizationId,
          ctx.userId,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = context(req);
      const data = parse(update, req.body);
      res.json({
        success: true,
        data: await conversationService.update(
          routeId(req),
          ctx.organizationId,
          ctx.userId,
          data,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = context(req);
      await conversationService.remove(routeId(req), ctx.organizationId, ctx.userId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
  async import(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = context(req);
      const data = parse(importing, req.body);
      res.status(201).json({
        success: true,
        data: await conversationService.import({ ...ctx, ...data }),
      });
    } catch (error) {
      next(error);
    }
  },
};
