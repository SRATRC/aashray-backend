import express from 'express';
const router = express.Router();
import {
  RegisterFood,
  RegisterForGuest,
  CancelFood,
  CancelGuestFood,
  FetchFoodBookings,
  FetchGuestFoodBookings
} from '../../controllers/client/foodBooking.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.post('/book', validateCard, CatchAsync(RegisterFood));
router.post('/bookGuest', validateCard, CatchAsync(RegisterForGuest));
router.delete('/cancel', validateCard, CatchAsync(CancelFood));
router.delete('/cancelGuest', validateCard, CatchAsync(CancelGuestFood));
router.get('/get', validateCard, CatchAsync(FetchFoodBookings));
router.get('/getGuest', validateCard, CatchAsync(FetchGuestFoodBookings));
export default router;
