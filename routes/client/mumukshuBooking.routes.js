import express from 'express';
const router = express.Router();
import {
  checkMumukshuOrGuest,
  mumukshuBooking,
  validateBooking
} from '../../controllers/client/mumukshuBooking.controller.js';
import { validateCard } from '../../middleware/validate.js';
import { holdValidateErrorsForOldApps } from '../../middleware/holdValidateErrorsForOldApps.js';
import CatchAsync from '../../utils/CatchAsync.js';

// TEMPORARY (see that file): wait on error replies for old apps. Keep it before validateCard.
router.post('/validate', holdValidateErrorsForOldApps);
router.use(validateCard);
router.get('/', CatchAsync(checkMumukshuOrGuest));
router.post('/booking', CatchAsync(mumukshuBooking));
router.post('/validate', CatchAsync(validateBooking));

export default router;
