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

router.get('/upcoming', validateCard, CatchAsync(FetchUpcoming));
router.get(
  '/booking/:cardno',
  validateCard,
  validateCard,
  CatchAsync(ViewUtsavBookings)
);
router.post('/booking', validateCard, CatchAsync(BookUtsav));
router.delete('/booking', validateCard, CatchAsync(CancelUtsavBooking));
router.get('/guest', validateCard, CatchAsync(ViewUtsavGuestBookings));
router.post('/guest', validateCard, CatchAsync(BookGuestUtsav));
router.delete('/guest', validateCard, CatchAsync(CancelUtsavGuestBooking));

export default router;
