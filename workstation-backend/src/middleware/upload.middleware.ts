import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import {
  ALLOWED_UPLOAD_TYPES_MESSAGE,
  isAllowedUploadExtension,
  normalizeUploadExtension,
} from '@aw/shared';
import { env } from '../config/env';
import { AppError } from '../utils/errors';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const uploadRoot = path.resolve(process.cwd(), env.uploadDir);
if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

function generateStoredFilename(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  return `${Date.now()}-${randomUUID()}${ext}`;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadRoot);
  },
  filename: (_req, file, cb) => {
    cb(null, generateStoredFilename(file.originalname));
  },
});

function fileFilter(_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ext = normalizeUploadExtension(file.originalname);

  if (!isAllowedUploadExtension(ext)) {
    cb(new AppError(400, ALLOWED_UPLOAD_TYPES_MESSAGE, 'INVALID_FILE_TYPE'));
    return;
  }

  cb(null, true);
}

export const uploadMiddleware = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
});

export { uploadRoot };
