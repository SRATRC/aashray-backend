import express from 'express';
const router = express.Router();
import { login, createAdmin } from '../../controllers/admin/auth.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_SUPER_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.post('/login', CatchAsync(login));
router.post(
  '/create',
  auth,
  authorizeRoles(ROLE_SUPER_ADMIN),
  CatchAsync(createAdmin)
);

export default router;
