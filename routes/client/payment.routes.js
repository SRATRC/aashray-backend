import express from 'express';
const router = express.Router();

import CatchAsync from '../../utils/CatchAsync.js';
import { verifyPayment } from '../../controllers/client/payment.controller.js';

router.get('/verify-payment', CatchAsync(verifyPayment));

export default router;
