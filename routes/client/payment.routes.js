import express from 'express';
const router = express.Router();

import CatchAsync from '../../utils/CatchAsync.js';
import { verifyPayment, createOrderIdForPendingPayments } from '../../controllers/client/payment.controller.js';

router.post('/verifyPayment', CatchAsync(verifyPayment));
router.post('/pay', CatchAsync(createOrderIdForPendingPayments));

export default router;
