import { Router } from 'express';
import { adminRechargeController } from '../../controllers/adminRecharge.controller';
import { adminLlmProviderController } from '../../controllers/adminLlmProvider.controller';
import { requireAuth, requireSystemAdmin } from '../../middleware/auth.middleware';

const router = Router();

router.use(requireAuth, requireSystemAdmin);

/** Phase 5: admin confirm + credit grant (no frontend). */
router.post('/recharge/orders/:id/confirm', adminRechargeController.confirmOrder);

/** Upstream 1701 probe (platform quota — not App CreditAccount). */
router.get('/llm-provider/status', adminLlmProviderController.status);
router.get('/llm-provider/quota', adminLlmProviderController.quota);

export default router;
