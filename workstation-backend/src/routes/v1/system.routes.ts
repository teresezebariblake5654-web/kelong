import { Router } from 'express';
import { requireAuth, requireOrganization } from '../../middleware/auth.middleware';
import { getSystemProviderHealth } from '../../services/system/provider-health.service';
import { AppError } from '../../utils/errors';

const router = Router();

router.get('/provider-health', requireAuth, requireOrganization, async (req, res, next) => {
  try {
    if (!req.org?.organizationId) {
      throw new AppError(400, '请提供 X-Organization-Id', 'ORGANIZATION_REQUIRED');
    }
    const data = await getSystemProviderHealth();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

export default router;
