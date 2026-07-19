import express from 'express';
const router = express.Router();
import {
  ViewAllBookings,
  CancelBooking,
  FlatBookingMumukshu,
  CheckBlockedDates
} from '../../controllers/client/roomBooking.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(validateCard);

router.post('/cancel', CatchAsync(CancelBooking));
// DEPRECATED: Use unified booking endpoint instead
router.post('/flat', CatchAsync(FlatBookingMumukshu));
router.get('/bookings', CatchAsync(ViewAllBookings));
router.post('/check-blocked-dates', CatchAsync(CheckBlockedDates));

export default router;
