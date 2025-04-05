import express from 'express';
const router = express.Router();
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_ACCOUNTS_ADMIN, ROLE_SUPER_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';
import { fetchCompletedTransactions } from '../../controllers/admin/accountsManagement.controller.js';

router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ROLE_ACCOUNTS_ADMIN));

router.get('/fetch', CatchAsync(fetchCompletedTransactions));

export default router;
