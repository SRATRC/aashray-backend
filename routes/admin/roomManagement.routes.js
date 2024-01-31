import express from 'express';
const router = express.Router();
import {
  occupancyReport,
  manualCheckin,
  manualCheckout,
  roomBooking,
  flatBooking,
  manualRoomAllocation,
  fetchAllRoomBookings,
  fetchAllFlatBookings,
  fetchRoomBookingsByCard,
  fetchFlatBookingsByCard,
  updateRoomBooking,
  updateFlatBooking,
  checkinReport,
  checkoutReport,
  blockRoom,
  unblockRoom,
  blockRC,
  unblockRC
} from '../../controllers/admin/roomManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.get(
  '/occupancyReport',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(occupancyReport)
);

router.put(
  '/checkin/:cardno',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(manualCheckin)
);

router.put(
  '/checkout/:cardno',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(manualCheckout)
);

router.post(
  '/bookForMumukshu/:mobno',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(roomBooking)
);

router.post(
  '/bookFlat/:mobno',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(flatBooking)
);

router.put(
  '/room_change/:cardno',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(manualRoomAllocation)
);

router.get(
  '/fetch_room_bookings',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(fetchAllRoomBookings)
);

router.get(
  '/fetch_flat_bookings',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(fetchAllFlatBookings)
);

router.get(
  '/fetch_room_bookings/:cardno',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(fetchRoomBookingsByCard)
);

router.get(
  '/fetch_flat_bookings/:cardno',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(fetchFlatBookingsByCard)
);

router.put(
  '/update_room_booking',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(updateRoomBooking)
);

router.put(
  '/update_flat_booking',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(updateFlatBooking)
);

router.get(
  '/checkin_report',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(checkinReport)
);

router.get(
  '/checkout_report',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(checkoutReport)
);

router.put(
  '/block_room/:roomno',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(blockRoom)
);

router.put(
  '/unblock_room/:roomno',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(unblockRoom)
);

router.post(
  '/block_rc',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(blockRC)
);

router.put(
  '/unblock_rc/:id',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(unblockRC)
);

export default router;
