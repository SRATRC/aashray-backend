import express from 'express';
const router = express.Router();
import {
  AvailabilityCalender,
  BookingForMumukshu,
  ViewAllBookings,
  FlatBooking,
  CancelBooking,
  AddWaitlist
} from '../../controllers/client/roomBooking.controller.js';
import CatchAsync from '../../utils/CatchAsync.js';
import { validateCard, CheckDatesBlocked } from '../../middleware/validate.js';

router.get('/availablity', CatchAsync(AvailabilityCalender));
router.post(
  '/mumukshu',
  validateCard,
  CheckDatesBlocked,
  CatchAsync(BookingForMumukshu)
);
router.post('/flat', validateCard, CatchAsync(FlatBooking));
router.post('/cancel/:cardno', validateCard, CatchAsync(CancelBooking)); // TODO: secure endpoint: users can cancel only their bookings
router.post('/waitlist', validateCard, CatchAsync(AddWaitlist));
router.get('/history/:cardno', validateCard, CatchAsync(ViewAllBookings));

export default router;
