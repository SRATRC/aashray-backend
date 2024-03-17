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

router.get('/booking/:cardno', validateCard, CatchAsync(FetchUpcoming));
router.post('/booking', validateCard, CatchAsync(BookTravel));
router.delete('/booking', validateCard, CatchAsync(CancelTravel));
router.get('/history/:cardno', validateCard, CatchAsync(ViewAllTravel));

export default router;
