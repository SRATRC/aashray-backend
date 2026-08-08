import express from 'express';
const router = express.Router();
import {
  ViewAllBookings,
  CancelBooking,
  FlatBookingMumukshu,
  CheckBlockedDates,
  GetBlockedDatesInRange
} from '../../controllers/client/roomBooking.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(validateCard);

router.post('/cancel', CatchAsync(CancelBooking));
// DEPRECATED: Use unified booking endpoint instead
router.post('/flat', CatchAsync(FlatBookingMumukshu));
router.get('/bookings', CatchAsync(ViewAllBookings));
router.post('/check-blocked-dates', CatchAsync(CheckBlockedDates));
router.get('/blocked-dates', CatchAsync(GetBlockedDatesInRange));

export default router;
