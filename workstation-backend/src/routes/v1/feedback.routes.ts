import { Router } from 'express';
import { feedbackController } from '../../controllers/feedback.controller';
import { feedbackRateLimiter } from '../../middleware/rateLimit.middleware';

const router = Router();

/** Public help & feedback form (no login required). */
router.post('/', feedbackRateLimiter, feedbackController.submit);

export default router;
