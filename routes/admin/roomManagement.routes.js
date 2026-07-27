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
  revokeLateCheckoutFee,
  createRoomBlock,
  listRoomBlocks,
  cancelRoomBlock,
  bulkCancelRoomBlocks,
  bulkRoomBooking,
  checkRoomConflict,
  getExemptions,
  createExemption,
  updateExemption,
  deleteExemption,
  getAllocationPriorities,
  updateAllocationPriority,
  deleteAllocationPriority
} from '../../controllers/admin/roomManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN, ROLE_ROOM_ADMIN, ROLE_HOUSEKEEPING_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);

// Allowed for housekeepingAdmin, officeAdmin, superAdmin, and roomAdmin
router.get('/occupancyReport', authorizeRoles(ROLE_HOUSEKEEPING_ADMIN, ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN, ROLE_ROOM_ADMIN), CatchAsync(occupancyReport));

router.use(authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN, ROLE_ROOM_ADMIN));

// room routes
router.post('/bookForMumukshu', CatchAsync(roomBooking));
router.put('/checkin/:bookingid', CatchAsync(manualCheckin));
router.put('/checkout/:bookingid', CatchAsync(manualCheckout));
router.put('/update_room_booking', CatchAsync(updateRoomBooking));
router.post('/check_room_conflict', CatchAsync(checkRoomConflict));
router.put('/update_booking_status', CatchAsync(updateBookingStatus));
router.get('/room_list', CatchAsync(roomList));
router.get('/available_rooms/:bookingid', CatchAsync(availableRooms));
router.get('/available_rooms_for_day', CatchAsync(availableRoomsForDay))
router.get('/fetch_room_bookings/:cardno', CatchAsync(fetchRoomBookingsByCard));

// booking exemption routes
router.get('/exemptions', CatchAsync(getExemptions));
router.post('/exemptions', CatchAsync(createExemption));
router.put('/exemptions/:id', CatchAsync(updateExemption));
router.delete('/exemptions/:id', CatchAsync(deleteExemption));

// room allocation priority routes
router.get('/allocation_priority', CatchAsync(getAllocationPriorities));
router.put('/allocation_priority', CatchAsync(updateAllocationPriority));
router.delete('/allocation_priority/:month', CatchAsync(deleteAllocationPriority));

// flat routes
router.post('/bookFlat/:mobno', CatchAsync(flatBooking));
router.put('/flat_checkin/:bookingid', CatchAsync(flatCheckin));
router.put('/flat_checkout/:bookingid', CatchAsync(flatCheckout));
router.put('/flat_cancel/:bookingid', CatchAsync(cancelFlatBooking));
router.get('/flat_list', CatchAsync(flatList));
router.get('/fetch_flat_bookings/:cardno', CatchAsync(fetchFlatBookingsByCard));
router.put('/update_flat_booking_status', CatchAsync(updateFlatBookingStatus));


// room management routes
router.put('/block_room/:roomno', CatchAsync(blockRoom));       // legacy — kept for backward compat
router.put('/unblock_room/:roomno', CatchAsync(unblockRoom));   // legacy — kept for backward compat
router.put('/update_room/:roomno', CatchAsync(updateRoom));

// date-range / permanent room block routes
router.post('/room_block', CatchAsync(createRoomBlock));
router.post('/room_block/bulk', CatchAsync(createRoomBlock));
router.get('/room_block', CatchAsync(listRoomBlocks));
router.delete('/room_block/:id', CatchAsync(cancelRoomBlock));
router.post('/room_block/bulk_cancel', CatchAsync(bulkCancelRoomBlocks));
router.post('/bulk_book', CatchAsync(bulkRoomBooking));

// RC management routes
router.post('/block_rc', CatchAsync(blockRC));
router.put('/unblock_rc/:id', CatchAsync(unblockRC));
router.get('/rc_block_list', CatchAsync(rcBlockList));

// reports
router.get('/reservation_report', CatchAsync(ReservationReport));
router.get('/flat_reservation_report', CatchAsync(flatReservationReport));
router.get('/daywise_report', CatchAsync(dayWiseGuestCountReport));
router.get('/guestsByDateAndRoomtype', CatchAsync(guestsByDateAndRoomtype));
router.get('/late-checkout-fees', CatchAsync(fetchLateCheckoutFees));
router.put('/late-checkout-fees/revoke', CatchAsync(revokeLateCheckoutFee));

export default router;
