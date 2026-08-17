import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { chatService } from '../services/chat.service';
import { chatTableExportService } from '../services/chatTableExport.service';
import { AppError } from '../utils/errors';

const sendMessageSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(100),
    agentCode: z
      .enum([
        'general',
        'data-analysis',
        'finance',
        'sales',
        'admin',
        'hr',
        'production',
        'logistics',
        'ecommerce',
      ])
      .default('general'),
    content: z.string().max(8000).default(''),
    fileIds: z.array(z.string().trim().min(1)).max(10).default([]),
    imageIds: z.array(z.string().trim().min(1)).max(10).default([]),
    templateCode: z.string().trim().min(1).max(100).optional(),
    userInstruction: z.string().trim().max(4000).optional(),
  })
  .strict();

const exportTableSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(100),
    content: z.string().trim().min(1).max(32_000),
  })
  .strict();

function requireUserOrg(req: Request) {
  if (!req.user) throw new AppError(401, '请先登录', 'UNAUTHORIZED');
  if (!req.org?.organizationId) {
    throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
  }
  return { organizationId: req.org.organizationId, userId: req.user.id };
}

export const chatController = {
  async sendMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = sendMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, '聊天请求格式无效', 'INVALID_CHAT_REQUEST');
      }
      const { organizationId, userId } = requireUserOrg(req);
      const data = await chatService.sendMessage({
        organizationId,
        userId,
        conversationId: parsed.data.conversationId,
        agentCode: parsed.data.agentCode,
        content: parsed.data.content,
        fileIds: parsed.data.fileIds,
        imageIds: parsed.data.imageIds,
        templateCode: parsed.data.templateCode,
        userInstruction: parsed.data.userInstruction,
      });
      // 不返回 provider / model / api 信息
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
  async exportTable(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = exportTableSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, '表格导出请求格式无效', 'INVALID_TABLE_EXPORT_REQUEST');
      }
      const { organizationId, userId } = requireUserOrg(req);
      const data = await chatTableExportService.exportMessage({
        organizationId,
        userId,
        conversationId: parsed.data.conversationId,
        content: parsed.data.content,
      });
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(data.fileName)}`,
      );
      res.setHeader('X-File-Name', encodeURIComponent(data.fileName));
      res.setHeader('Content-Length', data.buffer.length);
      res.send(data.buffer);
    } catch (error) {
      next(error);
    }
  },
};
