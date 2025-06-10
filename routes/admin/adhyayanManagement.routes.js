import express from 'express';
const router = express.Router();
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import {
  fetchAllAdhyayan,
  fetchAdhyayanBookings,
  createAdhyayan,
  updateAdhyayan,
  adhyayanWaitlist,
  adhyayanStatusUpdate,
  activateAdhyayan,
  fetchAdhyayan,
  fetchAllAdhyayanList,
  adhyayanPendinglist
} from '../../controllers/admin/adhyayanManagement.controller.js';
import {
  ROLE_SUPER_ADMIN,
  ROLE_ADHYAYAN_ADMIN,
  ROLE_OFFICE_ADMIN
} from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_ADHYAYAN_ADMIN, ROLE_SUPER_ADMIN));

router.post('/create', CatchAsync(createAdhyayan));
router.get('/fetch', CatchAsync(fetchAllAdhyayan));
router.get('/fetch/:id', CatchAsync(fetchAdhyayan));
router.put('/update/:id', CatchAsync(updateAdhyayan));
router.get('/waitlist/:id', CatchAsync(adhyayanWaitlist));
router.get('/pendinglist/:id', CatchAsync(adhyayanPendinglist));
router.get('/bookings', CatchAsync(fetchAdhyayanBookings));
router.put('/status', CatchAsync(adhyayanStatusUpdate));
router.put('/:id/:activate', CatchAsync(activateAdhyayan));
router.get('/fetchList', CatchAsync(fetchAllAdhyayanList));

export default router;
