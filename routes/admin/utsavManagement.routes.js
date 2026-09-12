import express from 'express';
import {
  ROLE_SUPER_ADMIN,
  ROLE_UTSAV_ADMIN,
  ROLE_PRA_ACCOUNTS_ADMIN,
  ROLE_ACCOUNTS_ADMIN,
  ROLE_UTSAV_READ_ONLY,
  ROLE_UTSAV_ADMIN_RAJ,
  ROLE_OFFICE_ADMIN,
  ROLE_HOUSEKEEPING_ADMIN
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
  // uploadRoomNoExcel,  // REMOVED: old bulk upload UI replaced by System Room Allocation
  // updateRoomNo,        // REMOVED: old inline edit UI replaced by System Room Allocation
  fetchVolunteerOptions,
  fetchUtsavByLocation,
  ReservationReport,
  issuePlate,
  createUtsavBookingByAdmin,
  addUtsavPackagesBulk,
  fetchUtsavFeedbacks,
  getSystemRoomAllocations,
  applyRoomAllocations,
  getRoomInventory,
  initRoomInventory,
  updateRoomConfig,
  updateRoomInventoryBulk,
  uploadExternalRooms,
  runSmartAllocationController,
  getHousekeepingExtraBedsReport,
  getUncheckedInBedsReport,
  reallotBed,
  getAllottedBedsReport,
  swapBeds,
  getParticipantStayHistory,
  utsavParticipantHistoryReport,
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

// Routes accessible to Housekeeping in addition to Utsav admins
utsavAdminRouter.get(
  '/housekeeping-extra-beds-report',
  authorizeRoles(
    ROLE_SUPER_ADMIN,
    ROLE_UTSAV_ADMIN,
    ROLE_PRA_ACCOUNTS_ADMIN,
    ROLE_ACCOUNTS_ADMIN,
    ROLE_UTSAV_READ_ONLY,
    ROLE_UTSAV_ADMIN_RAJ,
    ROLE_HOUSEKEEPING_ADMIN
  ),
  CatchAsync(getHousekeepingExtraBedsReport)
);

utsavAdminRouter.get(
  '/fetchList',
  authorizeRoles(
    ROLE_SUPER_ADMIN,
    ROLE_UTSAV_ADMIN,
    ROLE_PRA_ACCOUNTS_ADMIN,
    ROLE_ACCOUNTS_ADMIN,
    ROLE_UTSAV_READ_ONLY,
    ROLE_UTSAV_ADMIN_RAJ,
    ROLE_HOUSEKEEPING_ADMIN
  ),
  CatchAsync(fetchAllUtsavList)
);

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
utsavAdminRouter.get('/utsavCheckinReport', CatchAsync(utsavCheckinReport));
utsavAdminRouter.get(
  '/participantHistoryReport',
  CatchAsync(utsavParticipantHistoryReport)
);
// REMOVED: old bulk roomno upload UI replaced by System Room Allocation
// utsavAdminRouter.post(
//   '/uploadRoomNo',
//   upload.single('file'),
//   CatchAsync(uploadRoomNoExcel)
// );
// utsavAdminRouter.put('/updateRoomNo', CatchAsync(updateRoomNo));

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
utsavAdminRouter.post(
  '/send-group-reminder',
  authorizeRoles(ROLE_SUPER_ADMIN, ROLE_UTSAV_ADMIN, ROLE_OFFICE_ADMIN),
  CatchAsync(sendUtsavGroupReminder)
);


const ALLOCATION_WRITE_ROLES = [
  ROLE_SUPER_ADMIN,
  ROLE_UTSAV_ADMIN
];

const ALLOCATION_READ_ROLES = [
  ROLE_SUPER_ADMIN,
  ROLE_UTSAV_ADMIN,
  ROLE_PRA_ACCOUNTS_ADMIN,
  ROLE_ACCOUNTS_ADMIN
];

utsavAdminRouter.get('/system-room-allocation', authorizeRoles(...ALLOCATION_READ_ROLES), CatchAsync(getSystemRoomAllocations));
utsavAdminRouter.post('/apply-room-allocations', authorizeRoles(...ALLOCATION_WRITE_ROLES), CatchAsync(applyRoomAllocations));

// Smart Room Allocation Engine
utsavAdminRouter.get('/room-inventory', authorizeRoles(...ALLOCATION_READ_ROLES), CatchAsync(getRoomInventory));
utsavAdminRouter.post('/init-room-inventory', authorizeRoles(...ALLOCATION_WRITE_ROLES), CatchAsync(initRoomInventory));
utsavAdminRouter.post('/update-room-config', authorizeRoles(...ALLOCATION_WRITE_ROLES), CatchAsync(updateRoomConfig));
utsavAdminRouter.post('/update-room-inventory-bulk', authorizeRoles(...ALLOCATION_WRITE_ROLES), CatchAsync(updateRoomInventoryBulk));
utsavAdminRouter.post('/upload-external-rooms', authorizeRoles(...ALLOCATION_WRITE_ROLES), CatchAsync(uploadExternalRooms));
utsavAdminRouter.post('/run-smart-allocation', authorizeRoles(...ALLOCATION_WRITE_ROLES), CatchAsync(runSmartAllocationController));
utsavAdminRouter.get('/uncheckedin-beds-report', authorizeRoles(...ALLOCATION_READ_ROLES), CatchAsync(getUncheckedInBedsReport));
utsavAdminRouter.post('/reallot-bed', authorizeRoles(...ALLOCATION_WRITE_ROLES), CatchAsync(reallotBed));
utsavAdminRouter.get('/allotted-beds-report', authorizeRoles(...ALLOCATION_READ_ROLES), CatchAsync(getAllottedBedsReport));
utsavAdminRouter.post('/swap-beds', authorizeRoles(...ALLOCATION_WRITE_ROLES), CatchAsync(swapBeds));
utsavAdminRouter.get('/participant-stay-history', authorizeRoles(...ALLOCATION_READ_ROLES), CatchAsync(getParticipantStayHistory));

export { utsavPublicRouter, utsavAdminRouter };
