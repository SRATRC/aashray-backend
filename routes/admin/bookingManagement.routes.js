import express from 'express';
const router = express.Router();

import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN, ROLE_ROOM_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

import {
  cancelBooking,
  getBookingDetails,
  getBookingHistory
} from '../../controllers/admin/bookingManagement.controller.js';

router.use(auth);
router.use(authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN, ROLE_ROOM_ADMIN));


router.put('/cancel/:type/:bookingid', CatchAsync(cancelBooking));
router.get('/details/:type/:bookingid', CatchAsync(getBookingDetails));
router.get('/history', CatchAsync(getBookingHistory));

export default router;
