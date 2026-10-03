import express from 'express';
const router = express.Router();
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_MAINTENANCE_ADMIN, ROLE_SUPER_ADMIN, ROLE_ELECTRICAL_ADMIN, ROLE_HOUSEKEEPING_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';
import {
  fetchMaintenanceReport,
  updateMaintenanceRequest,
  fetchHousekeepingStatus,
  markDeepCleaningDone,
  updateDeepCleaningInterval
} from '../../controllers/admin/maintenanceManagement.controller.js';

router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ROLE_MAINTENANCE_ADMIN, ROLE_HOUSEKEEPING_ADMIN, ROLE_ELECTRICAL_ADMIN));

router.get('/fetch/:department', CatchAsync(fetchMaintenanceReport));
router.put('/update', CatchAsync(updateMaintenanceRequest));

// Housekeeping Deep Cleaning Tracker routes
router.get('/housekeeping/deep-cleaning/status', CatchAsync(fetchHousekeepingStatus));
router.post('/housekeeping/deep-cleaning/done', CatchAsync(markDeepCleaningDone));
router.post('/housekeeping/deep-cleaning/interval', CatchAsync(updateDeepCleaningInterval));

export default router;
