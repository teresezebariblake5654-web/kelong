import { Router } from 'express';
import { licensesController } from '../../controllers/licenses.controller';
import { licenseAuthMiddleware } from '../../middleware/licenseAuth.middleware';
import { authRateLimiter } from '../../middleware/rateLimit.middleware';

const router = Router();

router.post('/activate', authRateLimiter, licensesController.activate);
router.post('/verify', licenseAuthMiddleware, licensesController.verify);
router.post('/heartbeat', licenseAuthMiddleware, licensesController.heartbeat);
router.get('/current', licenseAuthMiddleware, licensesController.current);

export default router;
