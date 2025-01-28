import express from 'express';
const router = express.Router();
import {
  FetchAllShibir,
  FetchBookedShibir,
  CancelShibir,
  FetchShibirInRange
} from '../../controllers/client/adhyayanBooking.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(validateCard);

router.get('/getall', CatchAsync(FetchAllShibir));
router.get('/getbooked', CatchAsync(FetchBookedShibir));
router.delete('/cancel', CatchAsync(CancelShibir));
router.get('/getrange', CatchAsync(FetchShibirInRange));

export default router;
