import express from 'express';
const router = express.Router();
import {
  ViewAllBookings,
  CancelBooking,
  FlatBookingMumukshu
} from '../../controllers/client/roomBooking.controller.js';
import CatchAsync from '../../utils/CatchAsync.js';
import { validateCard, CheckDatesBlocked } from '../../middleware/validate.js';

router.use(validateCard);

router.post('/cancel', CatchAsync(CancelBooking));
router.post('/flat', CatchAsync(FlatBookingMumukshu));
router.get('/bookings', CatchAsync(ViewAllBookings));

export default router;
