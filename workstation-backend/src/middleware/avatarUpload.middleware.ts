import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import {
  IMAGE_UPLOAD_TYPES_MESSAGE,
  isImageUploadExtension,
  normalizeUploadExtension,
} from '@aw/shared';
import { env } from '../config/env';
import { AppError } from '../utils/errors';

/** Phone photos often exceed 2MB; keep a modest cap for disk + payload cost. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export const avatarUploadRoot = path.resolve(process.cwd(), env.uploadDir, 'avatars');
if (!fs.existsSync(avatarUploadRoot)) {
  fs.mkdirSync(avatarUploadRoot, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, avatarUploadRoot);
  },
  filename: (_req, file, cb) => {
    const ext = normalizeUploadExtension(file.originalname) || '.png';
    cb(null, `${Date.now()}-${randomUUID()}${ext}`);
  },
});

function fileFilter(_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (!isImageUploadExtension(file.originalname)) {
    cb(new AppError(400, IMAGE_UPLOAD_TYPES_MESSAGE, 'INVALID_FILE_TYPE'));
    return;
  }
  cb(null, true);
}

export const avatarUploadMiddleware = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_AVATAR_BYTES },
});
