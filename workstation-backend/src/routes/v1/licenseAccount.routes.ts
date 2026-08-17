import { Router } from 'express';
import { licenseAccountController } from '../../controllers/licenseAccount.controller';
import { licenseAuthMiddleware } from '../../middleware/licenseAuth.middleware';

const router = Router();

router.get('/wallet', licenseAuthMiddleware, licenseAccountController.wallet);
router.get(
  '/wallet/transactions',
  licenseAuthMiddleware,
  licenseAccountController.transactions,
);
router.get('/usage', licenseAuthMiddleware, licenseAccountController.usage);

export default router;
