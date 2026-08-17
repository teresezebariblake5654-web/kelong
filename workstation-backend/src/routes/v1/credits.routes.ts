import { Router } from 'express';
import { creditsController } from '../../controllers/credits.controller';
import { requireAuth, requireOrganization } from '../../middleware/auth.middleware';

const router = Router();

router.use(requireAuth);
router.get('/summary', requireOrganization, creditsController.summary);
router.get('/balance', requireOrganization, creditsController.balance);
router.get('/ledger', requireOrganization, creditsController.ledger);
router.post('/consume-chat-turn', requireOrganization, creditsController.consumeChatTurn);

export default router;
