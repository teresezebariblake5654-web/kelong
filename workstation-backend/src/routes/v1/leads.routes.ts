import { Router } from 'express';
import { leadsController } from '../../controllers/leads.controller';
import { requireAuth, requireOrganization } from '../../middleware/auth.middleware';

const router = Router();

router.use(requireAuth);
router.post('/discovery-preview', requireOrganization, leadsController.discoveryPreview);
/** Create PENDING task + enqueue; worker executes discovery asynchronously. */
router.post('/discovery', requireOrganization, leadsController.discovery);
router.get('/provider-health', requireOrganization, leadsController.providerHealth);
router.post(
  '/search-tasks/:taskId/cancel',
  requireOrganization,
  leadsController.cancelSearchTask,
);
/** Manual ICP rescore for an existing SearchTask (auto-score still runs after discovery). */
router.post(
  '/search-tasks/:taskId/score',
  requireOrganization,
  leadsController.scoreSearchTask,
);

/** Read-only resource pool */
router.get('/search-tasks', requireOrganization, leadsController.listSearchTasks);
router.get(
  '/search-tasks/:taskId/results',
  requireOrganization,
  leadsController.getSearchTaskResults,
);
router.get('/search-tasks/:taskId', requireOrganization, leadsController.getSearchTask);
router.get('/companies/:companyId', requireOrganization, leadsController.getCompanyDetail);

export default router;
