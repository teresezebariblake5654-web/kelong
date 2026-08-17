import { Router } from 'express';
import { filesController } from '../controllers/files.controller';
import { requireAuth, requireOrganization, requireOrganizationRole } from '../middleware/auth.middleware';
import { uploadRateLimiter } from '../middleware/rateLimit.middleware';
import { uploadMiddleware } from '../middleware/upload.middleware';

const router = Router();

router.use(requireAuth, requireOrganization);

router.post(
  '/upload',
  requireOrganizationRole('member'),
  uploadRateLimiter,
  uploadMiddleware.single('file'),
  filesController.upload,
);
router.get('/:fileId', filesController.get);
router.get('/:fileId/download', filesController.download);

export default router;
