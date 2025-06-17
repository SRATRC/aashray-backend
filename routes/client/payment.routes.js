import {
  verifyPayment,
  createOrderIdForPendingPayments,
  createOrderIdForPendingPaymentsV2
} from '../../controllers/client/payment.controller.js';
import { validateCard } from '../../middleware/validate.js';
import express from 'express';
import CatchAsync from '../../utils/CatchAsync.js';

const router = express.Router();

router.post('/verifyPayment', CatchAsync(verifyPayment));
router.post('/pay', validateCard, CatchAsync(createOrderIdForPendingPayments));
router.post(
  '/payv2',
  validateCard,
  CatchAsync(createOrderIdForPendingPaymentsV2)
);

export default router;
