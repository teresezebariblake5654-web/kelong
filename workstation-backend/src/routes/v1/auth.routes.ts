import { Router } from 'express';
import { authController } from '../../controllers/auth.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { avatarUploadMiddleware } from '../../middleware/avatarUpload.middleware';
import { authRateLimiter, uploadRateLimiter } from '../../middleware/rateLimit.middleware';

const router = Router();

router.post('/email-otp/send', authRateLimiter, authController.sendEmailOtp);
router.post('/register', authRateLimiter, authController.register);
router.post('/login', authRateLimiter, authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authMiddleware, authController.me);
router.post(
  '/me/avatar',
  authMiddleware,
  uploadRateLimiter,
  avatarUploadMiddleware.single('avatar'),
  authController.uploadAvatar,
);

export default router;
