import express from 'express';
const router = express.Router();
import {
  FetchUpcoming,
  BookUtsav,
  BookGuestUtsav,
  ViewUtsavBookings,
  CancelUtsavBooking,
  ViewUtsavGuestBookings,
  CancelUtsavGuestBooking
} from '../../controllers/client/utsavBooking.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.get('/upcoming', CatchAsync(FetchUpcoming));
router.post('/book', validateCard, CatchAsync(BookUtsav));
router.post('/guestbooking', validateCard, CatchAsync(BookGuestUtsav));
router.get('/viewbooking/:cardno', validateCard, CatchAsync(ViewUtsavBookings));
router.delete(
  '/cancel/:utsavid/:cardno',
  validateCard,
  CatchAsync(CancelUtsavBooking)
);
router.get(
  '/viewGuestbooking/:cardno',
  validateCard,
  CatchAsync(ViewUtsavGuestBookings)
);
router.delete(
  '/cancelGuest/:utsavid/:cardno',
  validateCard,
  CatchAsync(CancelUtsavGuestBooking)
);

export default router;
