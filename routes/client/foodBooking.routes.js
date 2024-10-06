import express from 'express';
const router = express.Router();
import {
  RegisterFood,
  RegisterForGuest,
  CancelFood,
  CancelGuestFood,
  FetchFoodBookings,
  FetchGuestsForFilter,
  FetchGuestFoodBookings,
  fetchMenu
} from '../../controllers/client/foodBooking.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(validateCard);

router.post('/book', CatchAsync(RegisterFood));
router.post('/bookGuest', CatchAsync(RegisterForGuest));
router.patch('/cancel', CatchAsync(CancelFood));
router.put('/cancelGuest', CatchAsync(CancelGuestFood));
router.get('/get', CatchAsync(FetchFoodBookings));
router.get('/getGuestsForFilter', CatchAsync(FetchGuestsForFilter));
router.get('/getGuest', CatchAsync(FetchGuestFoodBookings));
router.get('/menu', CatchAsync(fetchMenu));
export default router;
