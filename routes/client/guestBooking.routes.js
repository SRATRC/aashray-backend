import express from 'express';
const router = express.Router();
import { guestBooking } from '../../controllers/client/guestBooking.controller.js';
import { validateCard, CheckDatesBlocked } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(validateCard);

router.post('/booking', CheckDatesBlocked, CatchAsync(guestBooking));

export default router;
