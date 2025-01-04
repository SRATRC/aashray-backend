import express from 'express';
const router = express.Router();
import {
  fetchGuests,
  updateGuests,
  guestBooking,
  validateBooking
} from '../../controllers/client/guestBooking.controller.js';
import { validateCard, CheckDatesBlocked } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(validateCard);

router.get('/', CatchAsync(fetchGuests));
router.post('/', CatchAsync(updateGuests));
router.post('/booking', CheckDatesBlocked, CatchAsync(guestBooking));
router.post('/validate', CheckDatesBlocked, CatchAsync(validateBooking));

export default router;
