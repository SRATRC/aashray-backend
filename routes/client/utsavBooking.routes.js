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

router.use(validateCard);

router.get('/upcoming', CatchAsync(FetchUpcoming));
router.get('/booking', CatchAsync(ViewUtsavBookings));
router.post('/booking', CatchAsync(BookUtsav));
router.delete('/booking', CatchAsync(CancelUtsavBooking));
router.post('/guest', CatchAsync(BookGuestUtsav));

export default router;
