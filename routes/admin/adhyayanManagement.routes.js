import express from 'express';
const router = express.Router();
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import {
  fetchAllAdhyayan,
  fetchAdhyayan,
  createAdhyayan,
  updateAdhyayan,
  adhyayanReport,
  adhyayanWaitlist,
  adhyayanStatusUpdate,
  openCloseAdhyayan
} from '../../controllers/admin/adhyayanManagement.controller.js';
import {
  ROLE_SUPER_ADMIN,
  ROLE_ADHYAYAN_ADMIN
} from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_ADHYAYAN_ADMIN, ROLE_SUPER_ADMIN));

router.get('/fetch', CatchAsync(fetchAllAdhyayan));
router.post('/create', CatchAsync(createAdhyayan));
router.get('/fetch/:id', CatchAsync(fetchAdhyayan));
router.put('/update/:id', CatchAsync(updateAdhyayan));
router.post('/report/:id', CatchAsync(adhyayanReport));
router.get('/waitlist', CatchAsync(adhyayanWaitlist));
router.put('/status', CatchAsync(adhyayanStatusUpdate));
router.put('/:id/:activate', CatchAsync(openCloseAdhyayan));

export default router;
