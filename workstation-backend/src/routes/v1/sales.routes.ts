import { Router } from 'express';
import { salesController } from '../../controllers/sales.controller';
import { requireAuth, requireOrganization } from '../../middleware/auth.middleware';

const router = Router();

router.get('/webhooks/whatsapp', salesController.verifyWhatsAppWebhook);
router.post('/webhooks/whatsapp', salesController.receiveWhatsAppWebhook);
router.post('/webhooks/email', salesController.receiveEmailWebhook);

router.use(requireAuth);
router.post('/prospects', requireOrganization, salesController.createProspect);
router.get('/prospects', requireOrganization, salesController.listProspects);
router.get('/prospects/:prospectId', requireOrganization, salesController.getProspect);
router.post('/prospects/:prospectId/messages', requireOrganization, salesController.sendMessage);
router.get('/prospects/:prospectId/messages', requireOrganization, salesController.listMessages);
router.get('/prospects/:prospectId/activities', requireOrganization, salesController.listActivities);

router.post('/agent-profiles', requireOrganization, salesController.createAgentProfile);
router.get('/agent-profiles', requireOrganization, salesController.listAgentProfiles);
router.get('/agent-profiles/:profileId', requireOrganization, salesController.getAgentProfile);
router.post('/prospects/:prospectId/agent-run', requireOrganization, salesController.runAgent);
router.get('/prospects/:prospectId/agent-runs', requireOrganization, salesController.listAgentRuns);

export default router;
