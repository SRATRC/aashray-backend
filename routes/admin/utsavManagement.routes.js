import express from 'express';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import CatchAsync from '../../utils/CatchAsync.js';
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
  ReservationReport
} from '../../controllers/admin/utsavManagement.controller.js';
import { createUtsavBookingByAdmin } from '../../controllers/admin/utsavManagement.controller.js';

import {
  ROLE_SUPER_ADMIN,
  ROLE_UTSAV_ADMIN,
  ROLE_PRA_ACCOUNTS_ADMIN,
  ROLE_ACCOUNTS_ADMIN,
  ROLE_UTSAV_READ_ONLY,
  ROLE_UTSAV_ADMIN_RAJ
} from '../../config/constants.js';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() });

// ✅ Public router (NO auth required)
const utsavPublicRouter = express.Router();
utsavPublicRouter.post('/utsavCheckin', CatchAsync(utsavCheckin));

// ✅ Admin router (Auth required)
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
// Only allow admins with write permissions to create bookings (exclude read-only)
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
utsavAdminRouter.put('/updatepackage/:id/:utsavId', CatchAsync(updateUtsavPackage));
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
utsavAdminRouter.post('/uploadRoomNo', upload.single('file'), CatchAsync(uploadRoomNoExcel));
utsavAdminRouter.put('/updateRoomNo', CatchAsync(updateRoomNo));
utsavAdminRouter.get('/fetchVolunteerOptions', CatchAsync(fetchVolunteerOptions));
utsavAdminRouter.get('/pre_event_room_occupancy', CatchAsync(ReservationReport));
utsavAdminRouter.get('/post_event_room_occupancy', CatchAsync(ReservationReport));


// ✅ Export both routers
export { utsavPublicRouter, utsavAdminRouter };
