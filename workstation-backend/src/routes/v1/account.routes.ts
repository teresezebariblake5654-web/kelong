import { Router } from 'express';
import { accountController } from '../../controllers/account.controller';
import { requireAuth, requireOrganization } from '../../middleware/auth.middleware';

const router = Router();

router.get('/profile', requireAuth, requireOrganization, accountController.profile);

export default router;
