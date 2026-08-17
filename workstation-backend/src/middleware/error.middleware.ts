import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

function mapMulterError(err: multer.MulterError): AppError {
  if (err.code === 'LIMIT_FILE_SIZE') {
    if (err.field === 'avatar') {
      return new AppError(400, '头像文件过大，请压缩到 5MB 以内后再上传', 'AVATAR_TOO_LARGE');
    }
    return new AppError(400, '文件过大，请压缩后重试', 'FILE_TOO_LARGE');
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return new AppError(400, '上传字段不正确，请重试', 'UPLOAD_FIELD_INVALID');
  }
  return new AppError(400, '上传失败，请检查文件后重试', 'UPLOAD_FAILED');
}

export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId;
  const normalized =
    err instanceof multer.MulterError ? mapMulterError(err) : err;

  if (normalized instanceof AppError) {
    if (normalized.statusCode >= 500) {
      logger.error('app_error', {
        requestId,
        code: normalized.code,
        message: normalized.message,
      });
    }
    res.status(normalized.statusCode).json({
      success: false,
      message: normalized.message,
      code: normalized.code,
      ...(requestId ? { requestId } : {}),
    });
    return;
  }

  logger.error('unhandled_error', {
    requestId,
    error:
      normalized instanceof Error
        ? { name: normalized.name, message: normalized.message, stack: normalized.stack }
        : normalized,
  });
  res.status(500).json({
    success: false,
    message: '服务器内部错误',
    code: 'INTERNAL_ERROR',
    ...(requestId ? { requestId } : {}),
  });
}
