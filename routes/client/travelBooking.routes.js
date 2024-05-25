import express from 'express';
const router = express.Router();
import {
  BookTravel,
  FetchUpcoming,
  CancelTravel,
  ViewAllTravel
} from '../../controllers/client/travelBooking.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(validateCard);

router.get('/booking', CatchAsync(FetchUpcoming));
router.post('/booking', CatchAsync(BookTravel));
router.delete('/booking', CatchAsync(CancelTravel));
router.get('/history', CatchAsync(ViewAllTravel));

export default router;
