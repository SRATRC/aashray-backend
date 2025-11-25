import express from 'express';
const router = express.Router();
import {
  unifiedBooking,
  validateBooking
} from '../../controllers/client/unifiedBooking.controller.js';
import CatchAsync from '../../utils/CatchAsync.js';
import { validateCard } from '../../middleware/validate.js';

router.use(validateCard);

router.post('/booking', CatchAsync(unifiedBooking));
router.post('/validate', CatchAsync(validateBooking));

export default router;
