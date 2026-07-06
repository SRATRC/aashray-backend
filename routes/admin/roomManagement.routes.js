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
  availableRooms,
  updateRoom,
  flatList,
  flatReservationReport,
  flatCheckin,
  flatCheckout,
  cancelFlatBooking,
  availableRoomsForDay,
  updateBookingStatus,
  guestsByDateAndRoomtype,
  updateFlatBookingStatus,
  fetchLateCheckoutFees,
  revokeLateCheckoutFee
} from '../../controllers/admin/roomManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN, ROLE_ROOM_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN, ROLE_ROOM_ADMIN));

// room routes
router.post('/bookForMumukshu', CatchAsync(roomBooking));
router.put('/checkin/:bookingid', CatchAsync(manualCheckin));
router.put('/checkout/:bookingid', CatchAsync(manualCheckout));
router.put('/update_room_booking', CatchAsync(updateRoomBooking));
router.put('/update_booking_status', CatchAsync(updateBookingStatus));
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
router.put('/update_flat_booking_status', CatchAsync(updateFlatBookingStatus));


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
router.get('/guestsByDateAndRoomtype', CatchAsync(guestsByDateAndRoomtype));
router.get('/late-checkout-fees', CatchAsync(fetchLateCheckoutFees));
router.put('/late-checkout-fees/revoke', CatchAsync(revokeLateCheckoutFee));

export default router;
