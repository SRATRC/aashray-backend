import express from 'express';
const router = express.Router();
import {
  FetchAllShibir,
  RegisterShibir,
  FetchBookedShibir,
  CancelShibir
} from '../../controllers/client/adhyayanBooking.controller.js';
import { validateCard } from '../../middleware/validate.js';

router.get('/getall', validateCard, FetchAllShibir);
router.post('/register', validateCard, RegisterShibir);
router.get('/getbooked/:cardno', validateCard, FetchBookedShibir);
router.delete('/cancel', validateCard, CancelShibir);

export default router;
