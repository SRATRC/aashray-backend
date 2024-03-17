import express from 'express';
const router = express.Router();
import {
  createCard,
  fetchAllCards,
  searchCardsByName,
  updateCard,
  transferCard,
  fetchTotalTransactions
} from '../../controllers/admin/cardManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN));

router.post('/create', CatchAsync(createCard));
router.get('/getAll', CatchAsync(fetchAllCards));
router.get('/search/:name', CatchAsync(searchCardsByName));
router.put('/update', CatchAsync(updateCard));
router.put('/transfer', CatchAsync(transferCard));
router.get('/transactions/:cardno', CatchAsync(fetchTotalTransactions));
export default router;
