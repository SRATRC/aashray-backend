import express from 'express';
const router = express.Router();
import {
  fetchUpcomingBookings,
  updateBookingStatus,
  updateTransactionStatus
} from '../../controllers/admin/travelManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_SUPER_ADMIN, ROLE_TRAVEL_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_TRAVEL_ADMIN, ROLE_SUPER_ADMIN));

router.get('/upcoming', CatchAsync(fetchUpcomingBookings));
router.post('/booking/status', CatchAsync(updateBookingStatus));
router.post('/transaction/status', CatchAsync(updateTransactionStatus));

export default router;
