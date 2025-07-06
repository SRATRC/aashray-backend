import express from 'express';
const router = express.Router();
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import {
  createUtsav,
  addUtsavPackage,
  updateUtsav,
  fetchUtsavBookings,
  fetchAllUtsav,
  activateUtsav,
  utsavStatusUpdate,
  fetchUtsav,
  updateUtsavPackage,
  fetchAllPackages,
  fetchPackage,
  fetchAllUtsavList,
  utsavCheckin,
  utsavCheckinReport
} from '../../controllers/admin/utsavManagement.controller.js';
import {
  ROLE_SUPER_ADMIN,
  ROLE_UTSAV_ADMIN,
  ROLE_PRA_ACCOUNTS_ADMIN,
  ROLE_ACCOUNTS_ADMIN
  } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_UTSAV_ADMIN, ROLE_SUPER_ADMIN, ROLE_PRA_ACCOUNTS_ADMIN, ROLE_ACCOUNTS_ADMIN));

router.post('/create', CatchAsync(createUtsav));
router.post('/package', CatchAsync(addUtsavPackage));
router.put('/update/:id', CatchAsync(updateUtsav));
router.put('/updatepackage/:id/:utsavId', CatchAsync(updateUtsavPackage));
router.get('/bookings', CatchAsync(fetchUtsavBookings));
router.get('/fetchpackage', CatchAsync(fetchAllPackages));
router.get('/fetch', CatchAsync(fetchAllUtsav));
router.get('/fetch/:id', CatchAsync(fetchUtsav));
router.get('/fetchpackage/:id', CatchAsync(fetchPackage));
router.put('/:id/:activate', CatchAsync(activateUtsav));
router.put('/status', CatchAsync(utsavStatusUpdate));
router.get('/fetchList', CatchAsync(fetchAllUtsavList));
router.post('/utsavCheckin', CatchAsync(utsavCheckin));
router.get('/utsavCheckinReport', CatchAsync(utsavCheckinReport));

export default router;
