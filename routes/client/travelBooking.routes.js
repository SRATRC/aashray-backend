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

router.post('/book', validateCard, CatchAsync(BookTravel));
router.get('/upcoming/:cardno', validateCard, CatchAsync(FetchUpcoming));
router.delete('/cancel', validateCard, CatchAsync(CancelTravel));
router.get('/fetchAll/:cardno', validateCard, CatchAsync(ViewAllTravel));

export default router;
