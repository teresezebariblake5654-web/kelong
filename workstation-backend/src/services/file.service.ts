import path from 'path';
import fs from 'fs';
import { isExcelUploadExtension } from '@aw/shared';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { readExcelTool } from '../tools/readExcel.tool';
import { ParsedPreview } from './parser.service';

function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase().replace('.', '');
}

function toFileResponse(file: {
  id: string;
  originalName: string;
  size: number;
  extension: string;
  createdAt: Date;
}) {
  return {
    fileId: file.id,
    originalName: file.originalName,
    size: file.size,
    extension: file.extension,
    createdAt: file.createdAt,
  };
}

export const fileService = {
  async saveUploadedFile(userId: string, organizationId: string, file: Express.Multer.File) {
    const extension = getExtension(file.originalname);

    const record = await prisma.file.create({
      data: {
        userId,
        organizationId,
        originalName: file.originalname,
        storedName: file.filename,
        mimeType: file.mimetype,
        size: file.size,
        extension,
        storagePath: file.path,
        parsedStatus: 'pending',
      },
    });

    return toFileResponse(record);
  },

  async getById(organizationId: string, fileId: string) {
    const file = await prisma.file.findFirst({
      where: { id: fileId, organizationId },
    });

    if (!file) {
      throw new AppError(404, '文件不存在', 'NOT_FOUND');
    }

    if (!fs.existsSync(file.storagePath)) {
      throw new AppError(404, '文件不存在于存储路径', 'FILE_NOT_FOUND');
    }

    const base = toFileResponse(file);
    if (!isExcelUploadExtension(file.extension)) {
      return base;
    }

    const parsedPreview: ParsedPreview = readExcelTool(file.storagePath, file.extension);
    return {
      ...base,
      parsedPreview,
    };
  },

  async getDownload(organizationId: string, fileId: string) {
    const file = await prisma.file.findFirst({
      where: { id: fileId, organizationId },
      select: {
        originalName: true,
        mimeType: true,
        storagePath: true,
      },
    });
    if (!file || !fs.existsSync(file.storagePath)) {
      throw new AppError(404, '文件不存在', 'FILE_NOT_FOUND');
    }
    return file;
  },
};
