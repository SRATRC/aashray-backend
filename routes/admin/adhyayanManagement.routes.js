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
  createAdhyayanBookingByAdmin,
  toggleAttendance,
  createAttendanceEntryManually,
  bulkToggleAttendance,
  adhyayanGroupAudit,
  sendAdhyayanGroupReminder,
  fetchPastAdhyayanAttendanceReport,
  fetchPastAdhyayanParticipantsReport,
  fetchShibirSessionsManagement,
  deleteShibirSession,
  fetchAllPastAdhyayanAbsentees,
  restoreShibirSessions
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
router.put('/attendance/toggle', CatchAsync(toggleAttendance));
router.post('/attendance/bulk-toggle', CatchAsync(bulkToggleAttendance));
router.post(
  '/send-group-reminder',
  authorizeRoles(ROLE_SUPER_ADMIN, ROLE_ADHYAYAN_ADMIN, ROLE_OFFICE_ADMIN),
  CatchAsync(sendAdhyayanGroupReminder)
);
router.put('/:id/:activate', CatchAsync(activateAdhyayan));
router.get('/fetchList', CatchAsync(fetchAllAdhyayanList));
router.delete('/:id', CatchAsync(softDeleteShibir));
router.get('/feedback/:shibir_id', CatchAsync(getAdhyayanFeedback));
router.post('/attendance/:shibir_id/:session_no/:cardno', CatchAsync(markAdhyayanAttendance));
router.get('/attendance/report/:shibir_id', CatchAsync(fetchAdhyayanAttendanceReport));
router.get('/attendance/summary/:shibir_id', CatchAsync(fetchAdhyayanAttendanceSummary));
router.post('/booking/admin', CatchAsync(createAdhyayanBookingByAdmin));
router.post('/attendance/create', CatchAsync(createAttendanceEntryManually));
router.get('/group-audit', CatchAsync(adhyayanGroupAudit));
router.get(
  '/reports/past-attendance',
  authorizeRoles(
    ROLE_SUPER_ADMIN,
    ROLE_ADHYAYAN_ADMIN,
    ROLE_OFFICE_ADMIN,
    ROLE_ADHYAYAN_READ_ONLY
  ),
  CatchAsync(fetchPastAdhyayanAttendanceReport)
);
router.get(
  '/reports/:shibir_id/participants',
  authorizeRoles(
    ROLE_SUPER_ADMIN,
    ROLE_ADHYAYAN_ADMIN,
    ROLE_OFFICE_ADMIN,
    ROLE_ADHYAYAN_READ_ONLY
  ),
  CatchAsync(fetchPastAdhyayanParticipantsReport)
);
router.get(
  '/reports/:shibir_id/sessions',
  authorizeRoles(
    ROLE_SUPER_ADMIN,
    ROLE_ADHYAYAN_ADMIN,
    ROLE_OFFICE_ADMIN,
    ROLE_ADHYAYAN_READ_ONLY
  ),
  CatchAsync(fetchShibirSessionsManagement)
);
router.delete(
  '/reports/:shibir_id/sessions/:session_number',
  authorizeRoles(
    ROLE_SUPER_ADMIN,
    ROLE_ADHYAYAN_ADMIN,
    ROLE_OFFICE_ADMIN
  ),
  CatchAsync(deleteShibirSession)
);
router.post(
  '/reports/:shibir_id/sessions/restore',
  authorizeRoles(
    ROLE_SUPER_ADMIN,
    ROLE_ADHYAYAN_ADMIN,
    ROLE_OFFICE_ADMIN
  ),
  CatchAsync(restoreShibirSessions)
);
router.get(
  '/reports/all-absentees',
  authorizeRoles(
    ROLE_SUPER_ADMIN,
    ROLE_ADHYAYAN_ADMIN,
    ROLE_OFFICE_ADMIN,
    ROLE_ADHYAYAN_READ_ONLY
  ),
  CatchAsync(fetchAllPastAdhyayanAbsentees)
);

export default router;
