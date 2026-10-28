import express from 'express';
const router = express.Router();
import {
  fetchTotal,
  fetchMumukshu,
  fetchGuest,
  fetchPR,
  fetchSevaKutir,
  fetchResidents,
  gateEntry,
  gateRecord,
  gateExit,
  fetchGateHistoryByCard
} from '../../controllers/admin/gateManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_GATE_ADMIN, ROLE_SUPER_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_GATE_ADMIN, ROLE_SUPER_ADMIN));

router.get('/total', CatchAsync(fetchTotal));
router.get('/residents', CatchAsync(fetchResidents));
router.get('/totalPR', CatchAsync(fetchPR));
router.get('/totalGuest', CatchAsync(fetchGuest));
router.get('/totalMumukshu', CatchAsync(fetchMumukshu));
router.get('/totalSeva', CatchAsync(fetchSevaKutir));
router.post('/entry', CatchAsync(gateEntry));
router.post('/exit', CatchAsync(gateExit));
router.get('/gaterecords', CatchAsync(gateRecord));
router.get('/history/:cardno', CatchAsync(fetchGateHistoryByCard));

export default router;
