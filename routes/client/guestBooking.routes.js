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
import { holdValidateErrorsForOldApps } from '../../middleware/holdValidateErrorsForOldApps.js';
import CatchAsync from '../../utils/CatchAsync.js';

// TEMPORARY (see that file): wait on error replies for old apps. Keep it before validateCard.
router.post('/validate', holdValidateErrorsForOldApps);
router.use(validateCard);

router.get('/', CatchAsync(fetchGuests));
router.post('/', CatchAsync(createGuests));
router.post('/booking', CatchAsync(guestBooking));
router.post('/validate', CatchAsync(validateBooking));
// DEPRECATED: Use unified booking endpoint instead
router.post('/flat', CatchAsync(guestBookingFlat));
router.get('/check/:mobno', CatchAsync(checkGuests));

export default router;
