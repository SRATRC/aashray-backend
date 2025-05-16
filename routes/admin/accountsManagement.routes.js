import express from 'express';
const router = express.Router();
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() });

import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_ACCOUNTS_ADMIN, ROLE_SUPER_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

import {
  fetchCompletedTransactions,
  uploadRazorpaySettlementExcel,
  updateSettlementFieldsFromExcel,
  fetchAllSettlements,
  fetchTransactionsBySettlementId,
  fetchTransactionsByPaymentId
} from '../../controllers/admin/accountsManagement.controller.js';
import catchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ROLE_ACCOUNTS_ADMIN));

router.get('/fetch', CatchAsync(fetchCompletedTransactions));
router.post('/setrep', upload.single('file'), CatchAsync(uploadRazorpaySettlementExcel));
router.post('/updateset', upload.single('file'), CatchAsync(updateSettlementFieldsFromExcel));
router.get('/fetchset', CatchAsync(fetchAllSettlements));
router.get('/fetchTransactions/:settlementId', catchAsync(fetchTransactionsBySettlementId));
router.get('/fetchTransactions/payment/:razorpay_payment_id', catchAsync(fetchTransactionsByPaymentId));



export default router;
