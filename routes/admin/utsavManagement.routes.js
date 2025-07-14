// import express from 'express';
// const router = express.Router();
// import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
// import {
//   createUtsav,
//   addUtsavPackage,
//   updateUtsav,
//   fetchUtsavBookings,
//   fetchAllUtsav,
//   activateUtsav,
//   utsavStatusUpdate,
//   fetchUtsav,
//   updateUtsavPackage,
//   fetchAllPackages,
//   fetchPackage,
//   fetchAllUtsavList,
//   utsavCheckin,
//   utsavCheckinReport
// } from '../../controllers/admin/utsavManagement.controller.js';
// import {
//   ROLE_SUPER_ADMIN,
//   ROLE_UTSAV_ADMIN,
//   ROLE_PRA_ACCOUNTS_ADMIN,
//   ROLE_ACCOUNTS_ADMIN
//   } from '../../config/constants.js';
// import CatchAsync from '../../utils/CatchAsync.js';

// router.use(auth);
// router.use(authorizeRoles(ROLE_UTSAV_ADMIN, ROLE_SUPER_ADMIN, ROLE_PRA_ACCOUNTS_ADMIN, ROLE_ACCOUNTS_ADMIN));

// router.post('/create', CatchAsync(createUtsav));
// router.post('/package', CatchAsync(addUtsavPackage));
// router.put('/update/:id', CatchAsync(updateUtsav));
// router.put('/updatepackage/:id/:utsavId', CatchAsync(updateUtsavPackage));
// router.get('/bookings', CatchAsync(fetchUtsavBookings));
// router.get('/fetchpackage', CatchAsync(fetchAllPackages));
// router.get('/fetch', CatchAsync(fetchAllUtsav));
// router.get('/fetch/:id', CatchAsync(fetchUtsav));
// router.get('/fetchpackage/:id', CatchAsync(fetchPackage));
// router.put('/:id/:activate', CatchAsync(activateUtsav));
// router.put('/status', CatchAsync(utsavStatusUpdate));
// router.get('/fetchList', CatchAsync(fetchAllUtsavList));
// router.post('/utsavCheckin', CatchAsync(utsavCheckin));
// router.get('/utsavCheckinReport', CatchAsync(utsavCheckinReport));

// export default router;

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
  utsavCheckinReport
} from '../../controllers/admin/utsavManagement.controller.js';

import {
  ROLE_SUPER_ADMIN,
  ROLE_UTSAV_ADMIN,
  ROLE_PRA_ACCOUNTS_ADMIN,
  ROLE_ACCOUNTS_ADMIN
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
    ROLE_ACCOUNTS_ADMIN
  )
);

utsavAdminRouter.post('/create', CatchAsync(createUtsav));
utsavAdminRouter.post('/package', CatchAsync(addUtsavPackage));
utsavAdminRouter.put('/update/:id', CatchAsync(updateUtsav));
utsavAdminRouter.put('/updatepackage/:id/:utsavId', CatchAsync(updateUtsavPackage));
utsavAdminRouter.get('/bookings', CatchAsync(fetchUtsavBookings));
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
