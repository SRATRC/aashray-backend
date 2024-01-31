import express from 'express';
const router = express.Router();
import {
  createCard,
  fetchAllCards,
  searchCards,
  updateCard,
  transferCard
} from '../../controllers/admin/cardManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.post(
  '/create',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(createCard)
);
router.get(
  '/getAll',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(fetchAllCards)
);
// TODO: add search for name and cardno both in same query
router.get(
  '/search/:cardno',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(searchCards)
);
router.put(
  '/update',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(updateCard)
);
router.put(
  '/transfer',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(transferCard)
);
export default router;
