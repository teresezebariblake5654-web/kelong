import { Router } from 'express';
import { paymentController } from '../../controllers/payment.controller';
import { licenseAuthMiddleware } from '../../middleware/licenseAuth.middleware';

const router = Router();

router.get('/plans', paymentController.listPlans);
router.post('/orders', licenseAuthMiddleware, paymentController.createOrder);
router.get('/orders/:orderNo', licenseAuthMiddleware, paymentController.getOrder);

/** Dev-only mock settle; disabled in production inside the controller. */
router.post('/payments/mock/complete', paymentController.mockComplete);
router.post('/payments/wechat/notify', paymentController.wechatNotify);
router.post('/payments/alipay/notify', paymentController.alipayNotify);

export default router;
