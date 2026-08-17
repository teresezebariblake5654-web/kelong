import { Router } from 'express';
import { billingController } from '../controllers/billing.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);
router.get('/credits', billingController.credits);
router.get('/usage', billingController.usage);
router.post('/mock-recharge', billingController.mockRecharge);

export default router;
