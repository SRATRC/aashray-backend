import express from 'express';
const router = express.Router();
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import {
  fetchAllAdhyayan,
  fetchAdhyayanBookings,
  createAdhyayan,
  updateAdhyayan,
  adhyayanReport,
  adhyayanWaitlist,
  adhyayanStatusUpdate,
  activateAdhyayan,
  fetchAdhyayan
} from '../../controllers/admin/adhyayanManagement.controller.js';
import {
  ROLE_SUPER_ADMIN,
  ROLE_ADHYAYAN_ADMIN
} from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_ADHYAYAN_ADMIN, ROLE_SUPER_ADMIN));

router.post('/create', CatchAsync(createAdhyayan));
router.get('/fetch', CatchAsync(fetchAllAdhyayan));
router.get('/fetch/:id', CatchAsync(fetchAdhyayan));
router.put('/update/:id', CatchAsync(updateAdhyayan));
router.post('/report/:id', CatchAsync(adhyayanReport));
router.get('/waitlist', CatchAsync(adhyayanWaitlist));
router.put('/status', CatchAsync(adhyayanStatusUpdate));
router.put('/:id/:activate', CatchAsync(activateAdhyayan));

export default router;
