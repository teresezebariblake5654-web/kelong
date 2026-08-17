import { Router } from 'express';
import { aiController } from '../../controllers/ai.controller';
import { requireAuth, requireOrganization } from '../../middleware/auth.middleware';
import {
  aiConcurrencyLimiter,
  aiRateLimiter,
} from '../../middleware/rateLimit.middleware';

const router = Router();

router.post(
  '/analyze',
  requireAuth,
  requireOrganization,
  aiRateLimiter,
  aiConcurrencyLimiter,
  aiController.analyze,
);
router.post(
  '/analyze-image',
  requireAuth,
  requireOrganization,
  aiRateLimiter,
  aiConcurrencyLimiter,
  aiController.analyzeImage,
);
router.get('/tasks/:id', requireAuth, requireOrganization, aiController.task);

export default router;
