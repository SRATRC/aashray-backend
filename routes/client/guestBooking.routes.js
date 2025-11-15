import express from 'express';
const router = express.Router();
import {
  fetchGuests,
  createGuests,
  guestBooking,
  validateBooking,
  checkGuests,
  guestBookingFlat
} from '../../controllers/client/guestBooking.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(validateCard);

router.get('/', CatchAsync(fetchGuests));
router.post('/', CatchAsync(createGuests));
router.post('/booking', CatchAsync(guestBooking));
router.post('/validate', CatchAsync(validateBooking));
router.get('/check/:mobno', CatchAsync(checkGuests));
// DEPRECATED: Use unified booking endpoint instead
router.post('/flat', CatchAsync(guestBookingFlat));

export default router;
