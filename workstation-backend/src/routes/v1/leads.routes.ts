import { Router } from 'express';
import { leadsController } from '../../controllers/leads.controller';
import { requireAuth, requireOrganization } from '../../middleware/auth.middleware';

const router = Router();

router.use(requireAuth);
router.post('/discovery-preview', requireOrganization, leadsController.discoveryPreview);

export default router;
