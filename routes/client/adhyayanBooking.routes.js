import express from 'express';
const router = express.Router();
import {
  FetchAllShibir,
  RegisterShibir,
  FetchBookedShibir,
  CancelShibir
} from '../../controllers/client/adhyayanBooking.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(validateCard);

router.get('/getall', CatchAsync(FetchAllShibir));
router.post('/register', CatchAsync(RegisterShibir));
router.get('/getbooked', CatchAsync(FetchBookedShibir));
router.delete('/cancel', CatchAsync(CancelShibir));

export default router;
