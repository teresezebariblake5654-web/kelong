import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { aiTaskExecutionService } from '../services/aiTaskExecution.service';
import { imageAnalysisService } from '../services/imageAnalysis.service';
import { AppError } from '../utils/errors';

const analyzeSchema = z
  .object({
    taskCode: z.string().trim().min(1).max(100),
    templateVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    structuredData: z.record(z.unknown()),
    clientRequestId: z.string().uuid(),
    templateCode: z.string().trim().min(1).max(100).optional(),
    userInstruction: z.string().trim().max(4000).optional(),
  })
  .strict();

const analyzeImageSchema = z
  .object({
    fileId: z.string().trim().min(1).max(100),
    instruction: z.string().trim().min(1).max(2000).default('识别并分析图片内容'),
  })
  .strict();

function requireUserOrg(req: Request) {
  if (!req.user) {
    throw new AppError(401, '请先登录', 'UNAUTHORIZED');
  }
  if (!req.org?.organizationId) {
    throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
  }
  return {
    userId: req.user.id,
    organizationId: req.org.organizationId,
  };
}

function publicUsage(usage: {
  id: string;
  taskType: string;
  templateVersion: string;
  creditsReserved: number;
  creditsCharged: number;
  status: string;
  requestId: string;
  errorCode: string | null;
  result: unknown;
  createdAt: Date;
  completedAt: Date | null;
}) {
  // Never expose provider/model/token/cost internals to clients.
  return {
    taskId: usage.id,
    taskCode: usage.taskType,
    templateVersion: usage.templateVersion,
    creditsReserved: usage.creditsReserved,
    creditsCharged: usage.creditsCharged,
    status: usage.status,
    clientRequestId: usage.requestId,
    errorCode: usage.errorCode,
    result: usage.result,
    createdAt: usage.createdAt,
    completedAt: usage.completedAt,
  };
}

export const aiController = {
  async analyze(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = analyzeSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, 'AI 分析请求格式无效', 'INVALID_AI_REQUEST');
      }
      const { userId, organizationId } = requireUserOrg(req);
      const taskCode = parsed.data.templateCode || parsed.data.taskCode;
      const structuredInput = {
        ...parsed.data.structuredData,
        ...(parsed.data.userInstruction?.trim()
          ? { userInstruction: parsed.data.userInstruction.trim() }
          : {}),
      };
      const execution = await aiTaskExecutionService.execute({
        userId,
        organizationId,
        taskCode,
        templateVersion: parsed.data.templateVersion,
        structuredInput,
        requestId: parsed.data.clientRequestId,
      });
      res.json({
        success: true,
        data: {
          ...publicUsage(execution.usage),
          result: execution.result,
          idempotent: execution.idempotent,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async analyzeImage(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = analyzeImageSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, '图片识别请求格式无效', 'INVALID_IMAGE_REQUEST');
      }
      const { organizationId } = requireUserOrg(req);
      const data = await imageAnalysisService.analyzeImage({
        organizationId,
        fileId: parsed.data.fileId,
        instruction: parsed.data.instruction,
      });
      // Response intentionally carries no provider/model information.
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async task(req: Request, res: Response, next: NextFunction) {
    try {
      const { organizationId } = requireUserOrg(req);
      const usage = await aiTaskExecutionService.getTask(organizationId, String(req.params.id));
      res.json({ success: true, data: publicUsage(usage) });
    } catch (error) {
      next(error);
    }
  },
};
