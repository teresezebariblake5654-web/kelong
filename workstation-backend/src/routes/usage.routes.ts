import { Router } from 'express';
import { usageController } from '../controllers/usage.controller';
import { requireAuth, requireOrganization } from '../middleware/auth.middleware';

const router = Router();

router.use(requireAuth, requireOrganization);
router.get('/logs', usageController.getLogs);

export default router;
