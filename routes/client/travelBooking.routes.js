import express from 'express';
const router = express.Router();
import {
  FetchUpcoming,
  CancelTravel,
  checkUpcomingEvents
} from '../../controllers/client/travelBooking.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(validateCard);

router.get('/booking', CatchAsync(FetchUpcoming));
router.delete('/booking', CatchAsync(CancelTravel));
router.get('/events', CatchAsync(checkUpcomingEvents));

export default router;
