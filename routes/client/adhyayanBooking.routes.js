import express from 'express';
const router = express.Router();
import {
  FetchAllShibir,
  RegisterShibir,
  FetchBookedShibir,
  CancelShibir
} from '../../controllers/client/adhyayanBooking.controller.js';
import { validateCard } from '../../middleware/validate.js';

router.use(validateCard);

router.get('/getall', FetchAllShibir);
router.post('/register', RegisterShibir);
router.get('/getbooked/:cardno', FetchBookedShibir);
router.delete('/cancel', CancelShibir);

export default router;
