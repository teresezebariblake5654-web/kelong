import { Router } from 'express';
import { chatController } from '../../controllers/chat.controller';
import { requireAuth, requireOrganization } from '../../middleware/auth.middleware';
import {
  aiConcurrencyLimiter,
  chatRateLimiter,
} from '../../middleware/rateLimit.middleware';

const router = Router();

router.post(
  '/messages',
  requireAuth,
  requireOrganization,
  chatRateLimiter,
  aiConcurrencyLimiter,
  chatController.sendMessage,
);
router.post(
  '/export-table',
  requireAuth,
  requireOrganization,
  chatController.exportTable,
);

export default router;
