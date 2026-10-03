import express from 'express';
const router = express.Router();
import {
  logout,
  updatePassword,
  verifyAndLogin,
  forgotPassword,
  register,
  checkMobile
} from '../../controllers/client/auth.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';
import { rateLimit } from '../../middleware/rateLimit.js';

// Public routes that an outsider could use to probe or flood the member list.
const publicLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

router.get('/logout', CatchAsync(logout));
router.post('/updatePassword', validateCard, CatchAsync(updatePassword));
router.post('/verifyAndLogin', CatchAsync(verifyAndLogin));
router.post('/forgotPassword', CatchAsync(forgotPassword));
router.post('/register', publicLimiter, CatchAsync(register));
router.get('/checkMobile/:mobno', publicLimiter, CatchAsync(checkMobile));
export default router;
