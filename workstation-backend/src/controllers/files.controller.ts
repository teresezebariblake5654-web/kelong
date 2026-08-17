import { Request, Response, NextFunction } from 'express';
import { fileService } from '../services/file.service';
import { AppError } from '../utils/errors';

export const filesController = {
  async upload(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        throw new AppError(400, '请选择要上传的文件', 'BAD_REQUEST');
      }
      if (!req.org) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }

      const result = await fileService.saveUploadedFile(req.user!.id, req.org.organizationId, req.file);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.org) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }
      const file = await fileService.getById(req.org.organizationId, String(req.params.fileId));
      res.json({ success: true, data: file });
    } catch (error) {
      next(error);
    }
  },

  async download(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.org) {
        throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
      }
      const file = await fileService.getDownload(
        req.org.organizationId,
        String(req.params.fileId),
      );
      res.type(file.mimeType);
      res.download(file.storagePath, file.originalName);
    } catch (error) {
      next(error);
    }
  },
};
