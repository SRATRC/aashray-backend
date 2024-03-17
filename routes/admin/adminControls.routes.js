import express from 'express';
const router = express.Router();
import {
  fetchAllAdmins,
  updateAdminRoles,
  deactivateAdmin,
  activateAdmin,
  createRole,
  fetchRoles,
  deleteRole
} from '../../controllers/admin/adminControls.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_SUPER_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN));

router.get('/fetch_all_admins', CatchAsync(fetchAllAdmins));
router.put('/update_roles', CatchAsync(updateAdminRoles));
router.put('/deactivate/:username', CatchAsync(deactivateAdmin));
router.put('/activate/:username', CatchAsync(activateAdmin));
router.post('/role/:name', CatchAsync(createRole));
router.get('/role', CatchAsync(fetchRoles));
router.delete('/role/:name', CatchAsync(deleteRole));
export default router;
