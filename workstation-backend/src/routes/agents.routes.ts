import { Router } from 'express';
import { agentsController } from '../controllers/agents.controller';
import { requireAuth, requireOrganization, requireOrganizationRole } from '../middleware/auth.middleware';

const router = Router();

router.get('/', agentsController.list);
router.post(
  '/:agentId/run',
  requireAuth,
  requireOrganization,
  requireOrganizationRole('member'),
  agentsController.run,
);
router.get('/:agentId', agentsController.get);

export default router;
