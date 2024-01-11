import express from 'express';
const router = express.Router();
import {
  FetchUpcoming,
  BookUtsav,
  BookGuestUtsav,
  ViewUtsavBookings,
  CancelUtsavBooking
} from '../../controllers/client/utsavBooking.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.get('/upcoming', CatchAsync(FetchUpcoming));
router.post('/book', validateCard, CatchAsync(BookUtsav));
router.post('/guestbooking', validateCard, CatchAsync(BookGuestUtsav));
router.get('/viewbooking/:cardno', validateCard, CatchAsync(ViewUtsavBookings));
router.delete(
  '/cancel/:id/:cardno',
  validateCard,
  CatchAsync(CancelUtsavBooking)
);

export default router;
