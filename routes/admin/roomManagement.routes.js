import express from 'express';
const router = express.Router();
import {
  occupancyReport,
  manualCheckin,
  manualCheckout,
  roomBooking,
  flatBooking,
  fetchRoomBookingsByCard,
  fetchFlatBookingsByCard,
  updateRoomBooking,
  roomList,
  blockRoom,
  unblockRoom,
  rcBlockList,
  blockRC,
  unblockRC,
  ReservationReport,
  dayWiseGuestCountReport,
  cancelBooking,
  availableRooms,
  updateRoom,
  flatList,
  flatReservationReport,
  flatCheckin,
  flatCheckout,
  cancelFlatBooking,
  availableRoomsForDay
} from '../../controllers/admin/roomManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN));

// room routes
router.post('/bookForMumukshu', CatchAsync(roomBooking));
router.put('/checkin/:bookingid', CatchAsync(manualCheckin));
router.put('/checkout/:bookingid', CatchAsync(manualCheckout));
router.put('/cancel/:bookingid', CatchAsync(cancelBooking));
router.put('/update_room_booking', CatchAsync(updateRoomBooking));
router.get('/room_list', CatchAsync(roomList));
router.get('/available_rooms/:bookingid', CatchAsync(availableRooms));
router.get('/available_rooms_for_day', CatchAsync(availableRoomsForDay))
router.get('/fetch_room_bookings/:cardno', CatchAsync(fetchRoomBookingsByCard));

// flat routes
router.post('/bookFlat/:mobno', CatchAsync(flatBooking));
router.put('/flat_checkin/:bookingid', CatchAsync(flatCheckin));
router.put('/flat_checkout/:bookingid', CatchAsync(flatCheckout));
router.put('/flat_cancel/:bookingid', CatchAsync(cancelFlatBooking));
router.get('/flat_list', CatchAsync(flatList));
router.get('/fetch_flat_bookings/:cardno', CatchAsync(fetchFlatBookingsByCard));

// room management routes
router.put('/block_room/:roomno', CatchAsync(blockRoom));
router.put('/unblock_room/:roomno', CatchAsync(unblockRoom));
router.put('/update_room/:roomno', CatchAsync(updateRoom));

// RC management routes
router.post('/block_rc', CatchAsync(blockRC));
router.put('/unblock_rc/:id', CatchAsync(unblockRC));
router.get('/rc_block_list', CatchAsync(rcBlockList));

// reports
router.get('/reservation_report', CatchAsync(ReservationReport));
router.get('/flat_reservation_report', CatchAsync(flatReservationReport));
router.get('/daywise_report', CatchAsync(dayWiseGuestCountReport));
router.get('/occupancyReport', CatchAsync(occupancyReport));
// router.get('/waitlist_report', CatchAsync(WaitlistReport));
// router.get('/checkin_report', CatchAsync(checkinReport));
// router.get('/checkout_report', CatchAsync(checkoutReport));

export default router;
