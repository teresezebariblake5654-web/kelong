import { Router } from 'express';
import { adminController } from '../controllers/admin.controller';
import { authMiddleware, adminMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware, adminMiddleware);
router.get('/users', adminController.listUsers);
router.post('/users/:userId/credits', adminController.addCredits);
router.get('/usage', adminController.usage);

export default router;
