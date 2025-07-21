import express from 'express';
const router = express.Router();
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import {
  fetchRCAdhyayan,
  fetchKolAdhyayan,
  fetchRajAdhyayan,
  fetchDhuleAdhyayan,
  fetchAdhyayanBookings,
  createAdhyayan,
  updateAdhyayan,
  adhyayanWaitlist,
  adhyayanStatusUpdate,
  activateAdhyayan,
  fetchAdhyayan,
  fetchAllAdhyayanList,
  adhyayanPendinglist,
  fetchALLAdhyayan
} from '../../controllers/admin/adhyayanManagement.controller.js';
import {
  ROLE_SUPER_ADMIN,
  ROLE_ADHYAYAN_ADMIN,
  ROLE_OFFICE_ADMIN,
  ROLE_KOL_ADHYAYAN_ADMIN,
  ROLE_RAJ_ADHYAYAN_ADMIN,
  ROLE_DHU_ADHYAYAN_ADMIN,
  ROLE_ACCOUNTS_ADMIN, 
  ROLE_PRA_ACCOUNTS_ADMIN
} from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_ADHYAYAN_ADMIN, ROLE_SUPER_ADMIN, ROLE_DHU_ADHYAYAN_ADMIN, ROLE_RAJ_ADHYAYAN_ADMIN, ROLE_KOL_ADHYAYAN_ADMIN, ROLE_ACCOUNTS_ADMIN, ROLE_PRA_ACCOUNTS_ADMIN));

router.post('/create', CatchAsync(createAdhyayan));
router.get('/fetchALLadhyayan', CatchAsync(fetchALLAdhyayan));
router.get('/fetchRCadhyayan', CatchAsync(fetchRCAdhyayan));
router.get('/fetchKolAdhyayan', CatchAsync(fetchKolAdhyayan));
router.get('/fetchRajAdhyayan', CatchAsync(fetchRajAdhyayan));
router.get('/fetchDhuleAdhyayan', CatchAsync(fetchDhuleAdhyayan));
router.get('/fetch/:id', CatchAsync(fetchAdhyayan));
router.put('/update/:id', CatchAsync(updateAdhyayan));
router.get('/waitlist/:id', CatchAsync(adhyayanWaitlist));
router.get('/pendinglist/:id', CatchAsync(adhyayanPendinglist));
router.get('/bookings', CatchAsync(fetchAdhyayanBookings));
router.put('/status', CatchAsync(adhyayanStatusUpdate));
router.put('/:id/:activate', CatchAsync(activateAdhyayan));
router.get('/fetchList', CatchAsync(fetchAllAdhyayanList));

export default router;
