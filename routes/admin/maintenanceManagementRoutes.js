import express from 'express';
const router = express.Router();
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_MAINTENANCE_ADMIN, ROLE_SUPER_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';
import { fetchMaintenanceReport } from '../../controllers/admin/maintenanceManagement.controller.js';
// import { getMaintenanceById } from '../../controllers/admin/maintenanceManagement.controller.js';
import { updateMaintenanceRequest } from '../../controllers/admin/maintenanceManagement.controller.js';

router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ROLE_MAINTENANCE_ADMIN));

router.get('/fetch/:department', CatchAsync(fetchMaintenanceReport));
// router.get('/request/:id', CatchAsync(getMaintenanceById));
// router.post('/request/:id', CatchAsync(updateMaintenanceStatus));
// router.put('/update/:bookingid', CatchAsync(updateMaintenanceStatus));
router.put('/update', CatchAsync(updateMaintenanceRequest));

export default router;
