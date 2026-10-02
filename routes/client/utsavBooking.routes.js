import express from 'express';
const router = express.Router();
import {
  FetchUpcoming,
  ViewUtsavBookings,
  CancelUtsavBooking,
  FetchUtsavById,
  submitUtsavFeedback,
  validateUtsavFeedback
} from '../../controllers/client/utsavBooking.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(validateCard);

router.get('/upcoming', CatchAsync(FetchUpcoming));
router.get('/booking', CatchAsync(ViewUtsavBookings));
router.delete('/booking', CatchAsync(CancelUtsavBooking));
router.get('/:id', CatchAsync(FetchUtsavById));
router.post('/feedback', CatchAsync(submitUtsavFeedback));
router.get('/feedback/validate', CatchAsync(validateUtsavFeedback));

export default router;
