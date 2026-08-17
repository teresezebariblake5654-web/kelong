import fs from 'fs';
import { isImageUploadExtension } from '@aw/shared';
import { prisma } from '../config/database';
import { getImageAnalysisProvider, ImageAnalysisOutput } from '../providers/vision';
import { AppError } from '../utils/errors';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type ImageAnalysisTaskResult = {
  status: 'COMPLETED';
  result: ImageAnalysisOutput;
};

export const imageAnalysisService = {
  async analyzeImage(input: {
    organizationId: string;
    fileId: string;
    instruction: string;
  }): Promise<ImageAnalysisTaskResult> {
    // Scoped by organizationId: files of other organizations are invisible here.
    const file = await prisma.file.findFirst({
      where: { id: input.fileId, organizationId: input.organizationId },
    });
    if (!file) {
      throw new AppError(404, '文件不存在', 'NOT_FOUND');
    }

    const extension = file.extension.toLowerCase();
    const isImageExtension = isImageUploadExtension(extension);
    const isImageMime = file.mimeType.toLowerCase().startsWith('image/');
    if (!isImageExtension || !isImageMime) {
      throw new AppError(400, '该文件不是图片，无法识别', 'INVALID_IMAGE_FILE');
    }

    if (!fs.existsSync(file.storagePath)) {
      throw new AppError(404, '文件不存在于存储路径', 'FILE_NOT_FOUND');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new AppError(400, '图片过大，请压缩到 10MB 以内', 'IMAGE_TOO_LARGE');
    }

    const provider = getImageAnalysisProvider();
    const imageBase64 = fs.readFileSync(file.storagePath).toString('base64');
    const mimeType = file.mimeType.toLowerCase().startsWith('image/')
      ? file.mimeType
      : 'application/octet-stream';

    const result = await provider.analyzeImage({
      imageBase64,
      mimeType,
      instruction: input.instruction,
    });

    return { status: 'COMPLETED', result };
  },
};
