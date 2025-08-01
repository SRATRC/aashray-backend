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
  fetchAllUtsavList,
  utsavCheckin,
  utsavCheckinReport,
  fetchUtsavBookingsVolunteer
} from '../../controllers/admin/utsavManagement.controller.js';

import {
  ROLE_SUPER_ADMIN,
  ROLE_UTSAV_ADMIN,
  ROLE_PRA_ACCOUNTS_ADMIN,
  ROLE_ACCOUNTS_ADMIN,
  ROLE_UTSAV_READ_ONLY
} from '../../config/constants.js';

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
    ROLE_UTSAV_READ_ONLY
  )
);

utsavAdminRouter.post('/create', CatchAsync(createUtsav));
utsavAdminRouter.post('/package', CatchAsync(addUtsavPackage));
utsavAdminRouter.put('/update/:id', CatchAsync(updateUtsav));
utsavAdminRouter.put('/updatepackage/:id/:utsavId', CatchAsync(updateUtsavPackage));
utsavAdminRouter.get('/bookings', CatchAsync(fetchUtsavBookings));
utsavAdminRouter.get('/volunteer', CatchAsync(fetchUtsavBookingsVolunteer));
utsavAdminRouter.get('/fetchpackage', CatchAsync(fetchAllPackages));
utsavAdminRouter.get('/fetch', CatchAsync(fetchAllUtsav));
utsavAdminRouter.get('/fetch/:id', CatchAsync(fetchUtsav));
utsavAdminRouter.get('/fetchpackage/:id', CatchAsync(fetchPackage));
utsavAdminRouter.put('/:id/:activate', CatchAsync(activateUtsav));
utsavAdminRouter.put('/status', CatchAsync(utsavStatusUpdate));
utsavAdminRouter.get('/fetchList', CatchAsync(fetchAllUtsavList));
utsavAdminRouter.get('/utsavCheckinReport', CatchAsync(utsavCheckinReport));

// ✅ Export both routers
export { utsavPublicRouter, utsavAdminRouter };
