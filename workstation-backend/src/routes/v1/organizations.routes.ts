import { Router } from 'express';
import { organizationsController } from '../../controllers/organizations.controller';
import { requireAuth } from '../../middleware/auth.middleware';

const router = Router();

router.use(requireAuth);

router.get('/', organizationsController.list);
router.get('/:orgId', organizationsController.get);
router.get('/:orgId/members', organizationsController.listMembers);
router.post('/:orgId/members', organizationsController.addMember);
router.patch('/:orgId/members/:memberId', organizationsController.updateMember);
router.delete('/:orgId/members/:memberId', organizationsController.removeMember);

export default router;
