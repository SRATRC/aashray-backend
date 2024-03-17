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
  unblockRC,
  ReservationReport,
  CancellationReport,
  WaitlistReport,
  dayWiseGuestCountReport
} from '../../controllers/admin/roomManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN));

router.get('/occupancyReport', CatchAsync(occupancyReport));
router.put('/checkin/:cardno', CatchAsync(manualCheckin));
router.put('/checkout/:cardno', CatchAsync(manualCheckout));
router.post('/bookForMumukshu/:mobno', CatchAsync(roomBooking));
router.post('/bookFlat/:mobno', CatchAsync(flatBooking));
router.put('/room_change/:cardno', CatchAsync(manualRoomAllocation));
router.get('/fetch_room_bookings', CatchAsync(fetchAllRoomBookings));
router.get('/fetch_flat_bookings', CatchAsync(fetchAllFlatBookings));
router.get('/fetch_room_bookings/:cardno', CatchAsync(fetchRoomBookingsByCard));
router.get('/fetch_flat_bookings/:cardno', CatchAsync(fetchFlatBookingsByCard));
router.put('/update_room_booking', CatchAsync(updateRoomBooking));
router.put('/update_flat_booking', CatchAsync(updateFlatBooking));
router.get('/checkin_report', CatchAsync(checkinReport));
router.get('/checkout_report', CatchAsync(checkoutReport));
router.put('/block_room/:roomno', CatchAsync(blockRoom));
router.put('/unblock_room/:roomno', CatchAsync(unblockRoom));
router.post('/block_rc', CatchAsync(blockRC));
router.put('/unblock_rc/:id', CatchAsync(unblockRC));
router.get('/reservation_report', CatchAsync(ReservationReport));
router.get('/cancellation_report', CatchAsync(CancellationReport));
router.get('/waitlist_report', CatchAsync(WaitlistReport));
router.get('/daywise_report', CatchAsync(dayWiseGuestCountReport));

export default router;
