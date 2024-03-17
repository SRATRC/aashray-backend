import express from 'express';
const router = express.Router();
import {
  fetchTotal,
  fetchMumukshu,
  fetchPR,
  fetchSevaKutir
} from '../../controllers/admin/gateManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN));

router.get('/total', CatchAsync(fetchTotal));
router.get('/totalPR', CatchAsync(fetchPR));
router.get('/totalMumukshu', CatchAsync(fetchMumukshu));
router.get('/totalSeva', CatchAsync(fetchSevaKutir));

export default router;
