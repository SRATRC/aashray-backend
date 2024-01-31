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

router.get(
  '/total',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(fetchTotal)
);

router.get(
  '/totalPR',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(fetchPR)
);

router.get(
  '/totalMumukshu',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(fetchMumukshu)
);

router.get(
  '/totalSeva',
  auth,
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN),
  CatchAsync(fetchSevaKutir)
);

export default router;
