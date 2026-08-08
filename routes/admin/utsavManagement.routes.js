import express from 'express';
import {
  ROLE_SUPER_ADMIN,
  ROLE_UTSAV_ADMIN,
  ROLE_PRA_ACCOUNTS_ADMIN,
  ROLE_ACCOUNTS_ADMIN,
  ROLE_UTSAV_READ_ONLY,
  ROLE_UTSAV_ADMIN_RAJ
} from '../../config/constants.js';
import {
  createUtsav,
  addUtsavPackage,
  updateUtsav,
  fetchUtsavBookings,
  fetchAllUtsav,
  activateUtsav,
  utsavStatusUpdate,
  fetchUtsav,
  updateUtsavPackage,
  fetchAllPackages,
  fetchPackage,
  fetchPackagesByUtsav,
  fetchAllUtsavList,
  utsavCheckin,
  utsavCheckinReport,
  fetchUtsavBookingsVolunteer,
  uploadRoomNoExcel,
  updateRoomNo,
  fetchVolunteerOptions,
  fetchUtsavByLocation,
  ReservationReport,
  issuePlate,
  createUtsavBookingByAdmin,
  addUtsavPackagesBulk,
  fetchUtsavFeedbacks,
  utsavGroupAudit,
  sendUtsavGroupReminder
} from '../../controllers/admin/utsavManagement.controller.js';

import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import multer from 'multer';
import CatchAsync from '../../utils/CatchAsync.js';

const upload = multer({ storage: multer.memoryStorage() });

// Public routes
const utsavPublicRouter = express.Router();
utsavPublicRouter.post('/utsavCheckin', CatchAsync(utsavCheckin));
utsavPublicRouter.post('/issue/:cardno', CatchAsync(issuePlate));

// Protected routes
const utsavAdminRouter = express.Router();
utsavAdminRouter.use(auth);
utsavAdminRouter.use(
  authorizeRoles(
    ROLE_UTSAV_ADMIN,
    ROLE_SUPER_ADMIN,
    ROLE_PRA_ACCOUNTS_ADMIN,
    ROLE_ACCOUNTS_ADMIN,
    ROLE_UTSAV_READ_ONLY,
    ROLE_UTSAV_ADMIN_RAJ
  )
);

utsavAdminRouter.post('/create', CatchAsync(createUtsav));
utsavAdminRouter.post('/package', CatchAsync(addUtsavPackage));
utsavAdminRouter.post('/package/bulk', CatchAsync(addUtsavPackagesBulk));
utsavAdminRouter.post(
  '/booking',
  authorizeRoles(
    ROLE_UTSAV_ADMIN,
    ROLE_SUPER_ADMIN,
    ROLE_PRA_ACCOUNTS_ADMIN,
    ROLE_ACCOUNTS_ADMIN
  ),
  CatchAsync(createUtsavBookingByAdmin)
);
utsavAdminRouter.put('/update/:id', CatchAsync(updateUtsav));
utsavAdminRouter.put(
  '/updatepackage/:id',
  CatchAsync(updateUtsavPackage)
);
utsavAdminRouter.get('/bookings', CatchAsync(fetchUtsavBookings));
utsavAdminRouter.get('/volunteer', CatchAsync(fetchUtsavBookingsVolunteer));
utsavAdminRouter.get('/fetchpackage', CatchAsync(fetchAllPackages));
utsavAdminRouter.get('/fetchPackagesByUtsav', CatchAsync(fetchPackagesByUtsav));
utsavAdminRouter.get('/fetch', CatchAsync(fetchAllUtsav));
utsavAdminRouter.get('/fetchUtsav', CatchAsync(fetchUtsavByLocation));
utsavAdminRouter.get('/fetch/:id', CatchAsync(fetchUtsav));
utsavAdminRouter.get('/fetchpackage/:id', CatchAsync(fetchPackage));
utsavAdminRouter.put('/:id/:activate', CatchAsync(activateUtsav));
utsavAdminRouter.put('/status', CatchAsync(utsavStatusUpdate));
utsavAdminRouter.get('/fetchList', CatchAsync(fetchAllUtsavList));
utsavAdminRouter.get('/utsavCheckinReport', CatchAsync(utsavCheckinReport));
utsavAdminRouter.post(
  '/uploadRoomNo',
  upload.single('file'),
  CatchAsync(uploadRoomNoExcel)
);
utsavAdminRouter.put('/updateRoomNo', CatchAsync(updateRoomNo));
utsavAdminRouter.get(
  '/fetchVolunteerOptions',
  CatchAsync(fetchVolunteerOptions)
);
utsavAdminRouter.get(
  '/pre_event_room_occupancy',
  CatchAsync(ReservationReport)
);
utsavAdminRouter.get(
  '/post_event_room_occupancy',
  CatchAsync(ReservationReport)
);
utsavAdminRouter.get(
  '/utsav-feedback',
  CatchAsync(fetchUtsavFeedbacks)
);
utsavAdminRouter.get('/group-audit', CatchAsync(utsavGroupAudit));
utsavAdminRouter.post('/send-group-reminder', CatchAsync(sendUtsavGroupReminder));

export { utsavPublicRouter, utsavAdminRouter };
