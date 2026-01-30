import express from 'express';
const router = express.Router();
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import {
  fetchPGS,
  fetchAdhyayanByLocation,
  fetchAdhyayanBookings,
  createAdhyayan,
  updateAdhyayan,
  adhyayanWaitlist,
  adhyayanStatusUpdate,
  activateAdhyayan,
  fetchAdhyayan,
  fetchAllAdhyayanList,
  adhyayanPendinglist,
  fetchALLAdhyayan,
  softDeleteShibir,
  getAdhyayanFeedback,
  markAdhyayanAttendance,
  fetchAdhyayanAttendanceReport,
  fetchAdhyayanAttendanceSummary,
  createAdhyayanBookingByAdmin
} from '../../controllers/admin/adhyayanManagement.controller.js';
import {
  ROLE_SUPER_ADMIN,
  ROLE_ADHYAYAN_ADMIN,
  ROLE_OFFICE_ADMIN,
  ROLE_KOL_ADHYAYAN_ADMIN,
  ROLE_RAJ_ADHYAYAN_ADMIN,
  ROLE_DHU_ADHYAYAN_ADMIN,
  ROLE_ACCOUNTS_ADMIN,
  ROLE_PRA_ACCOUNTS_ADMIN,
  ROLE_ADHYAYAN_READ_ONLY,
  ROLE_UTSAV_ADMIN
} from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(
  authorizeRoles(
    ROLE_OFFICE_ADMIN,
    ROLE_ADHYAYAN_ADMIN,
    ROLE_SUPER_ADMIN,
    ROLE_DHU_ADHYAYAN_ADMIN,
    ROLE_RAJ_ADHYAYAN_ADMIN,
    ROLE_KOL_ADHYAYAN_ADMIN,
    ROLE_ACCOUNTS_ADMIN,
    ROLE_PRA_ACCOUNTS_ADMIN,
    ROLE_ADHYAYAN_READ_ONLY,
    ROLE_UTSAV_ADMIN
  )
);

router.post('/create', CatchAsync(createAdhyayan));
router.get('/fetchALLadhyayan', CatchAsync(fetchALLAdhyayan));
router.get('/fetchPGS', CatchAsync(fetchPGS));
router.get('/fetchAdhyayan', CatchAsync(fetchAdhyayanByLocation));
router.get('/fetch/:id', CatchAsync(fetchAdhyayan));
router.put('/update/:id', CatchAsync(updateAdhyayan));
router.get('/waitlist/:id', CatchAsync(adhyayanWaitlist));
router.get('/pendinglist/:id', CatchAsync(adhyayanPendinglist));
router.get('/bookings', CatchAsync(fetchAdhyayanBookings));
router.put('/status', CatchAsync(adhyayanStatusUpdate));
router.put('/:id/:activate', CatchAsync(activateAdhyayan));
router.get('/fetchList', CatchAsync(fetchAllAdhyayanList));
router.delete('/:id', CatchAsync(softDeleteShibir));
router.get('/feedback/:shibir_id', CatchAsync(getAdhyayanFeedback));
router.post('/attendance/:shibir_id/:session_no/:cardno', CatchAsync(markAdhyayanAttendance));
router.get('/attendance/report/:shibir_id', CatchAsync(fetchAdhyayanAttendanceReport));
router.get('/attendance/summary/:shibir_id', CatchAsync(fetchAdhyayanAttendanceSummary));
router.post('/booking/admin', CatchAsync(createAdhyayanBookingByAdmin));

export default router;
