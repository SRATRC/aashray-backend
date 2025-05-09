import express from 'express';
const router = express.Router();
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import {
  createUtsav,
  addUtsavPackage,
  updateUtsav,
  fetchUtsavBookings,
  fetchAllUtsav,
  utsavWaitlist,
  activateUtsav,
  utsavStatusUpdate
} from '../../controllers/admin/utsavManagement.controller.js';
import {
  ROLE_SUPER_ADMIN,
  ROLE_UTSAV_ADMIN
  } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_UTSAV_ADMIN, ROLE_SUPER_ADMIN));

router.post('/create', CatchAsync(createUtsav));
router.post('/package', CatchAsync(addUtsavPackage));
router.put('/update/:id', CatchAsync(updateUtsav));
router.get('/bookings', CatchAsync(fetchUtsavBookings));
router.get('/fetch', CatchAsync(fetchAllUtsav));
router.get('/waitlist/:id', CatchAsync(utsavWaitlist));
router.put('/:id/:activate', CatchAsync(activateUtsav));
router.put('/status', CatchAsync(utsavStatusUpdate));

export default router;
