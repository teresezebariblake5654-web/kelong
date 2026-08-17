import { Router } from 'express';
import { reportsController } from '../controllers/reports.controller';
import { requireAuth, requireOrganization } from '../middleware/auth.middleware';

const router = Router();

router.use(requireAuth, requireOrganization);

router.post('/mock-create', reportsController.mockCreate);
router.get('/', reportsController.list);
router.get('/:reportId', reportsController.get);

export default router;
