import express from 'express';
const router = express.Router();
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() });

import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_ACCOUNTS_ADMIN, ROLE_SUPER_ADMIN, ROLE_PRA_ACCOUNTS_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

import {
  fetchCompletedTransactions,
  fetchPendingTransactions,
  fetchAllCreditTransactions,
  uploadRazorpaySettlementExcel,
  updateSettlementFieldsFromExcel,
  fetchAllSettlements,
  fetchTransactionsBySettlementId,
  fetchTransactionsByPaymentId,
  fetchCredits,
  fetchCreditTransactions
} from '../../controllers/admin/accountsManagement.controller.js';
import catchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ROLE_ACCOUNTS_ADMIN, ROLE_PRA_ACCOUNTS_ADMIN));

router.get('/fetchcompleted', CatchAsync(fetchCompletedTransactions));
router.get('/fetchpending', CatchAsync(fetchPendingTransactions));
router.get('/fetchcredits', CatchAsync(fetchAllCreditTransactions));
router.post('/setrep', upload.single('file'), CatchAsync(uploadRazorpaySettlementExcel));
router.post('/updateset', upload.single('file'), CatchAsync(updateSettlementFieldsFromExcel));
router.get('/fetchset', CatchAsync(fetchAllSettlements));
router.get('/fetchTransactions/:settlementId', catchAsync(fetchTransactionsBySettlementId));
router.get('/fetchTransactions/payment/:razorpay_order_id', catchAsync(fetchTransactionsByPaymentId));
router.get('/credits', catchAsync(fetchCredits));
router.get('/fetchcreditstransactions', catchAsync(fetchCreditTransactions));



export default router;
