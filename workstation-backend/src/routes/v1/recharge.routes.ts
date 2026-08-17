import { Router } from 'express';
import { rechargeController } from '../../controllers/recharge.controller';
import { requireAuth } from '../../middleware/auth.middleware';

const router = Router();

/** Phase 3: catalog (public). */
router.get('/plans', rechargeController.listPlans);
/** Phase 7: payment display settings (public). */
router.get('/settings', rechargeController.getSettings);

/** Phase 4: user recharge orders (auth required). */
router.post('/orders', requireAuth, rechargeController.createOrder);
router.get('/orders', requireAuth, rechargeController.listOrders);
router.get('/orders/:id', requireAuth, rechargeController.getOrder);
router.post('/orders/:id/mark-paid', requireAuth, rechargeController.markPaid);
router.post('/orders/:id/cancel', requireAuth, rechargeController.cancel);

export default router;
