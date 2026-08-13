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

router.get('/logout', CatchAsync(logout));
router.post('/updatePassword', validateCard, CatchAsync(updatePassword));
router.post('/verifyAndLogin', CatchAsync(verifyAndLogin));
router.post('/forgotPassword', CatchAsync(forgotPassword));
router.post('/register', CatchAsync(register));
router.get('/checkMobile/:mobno', CatchAsync(checkMobile));
export default router;
