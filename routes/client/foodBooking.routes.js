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

router.post('/book', validateCard, RegisterFood);
router.post('/bookGuest', validateCard, RegisterForGuest);
router.delete('/cancel', validateCard, CancelFood);
router.delete('/cancelGuest', validateCard, CancelGuestFood);
router.get('/get', validateCard, FetchFoodBookings);
router.get('/getGuest', validateCard, FetchGuestFoodBookings);
export default router;
