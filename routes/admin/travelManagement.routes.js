import express from 'express';
const router = express.Router();
import {
  fetchUpcomingBookings,
  updateBookingStatus,
  updateTransactionStatus,
  fetchSummary,
  fetchBookingForDriver,
  updateBooking,
  createBusGroup,
  assignPassengersToBus,
  fetchBusGroupDetails,
  setBusCoordinator,
  fetchAllBusGroups,
  fetchAvailableTravelBookings,
  removePassengerFromBus,
  updateBusCapacity,
  updateBusGroup,
  bulkAssignPassengersToBus,
  previewBulkUpload,
  exportBusPassengers,
  deleteBusGroup,
  previewCreateBusGroup,
  previewUpdateBusGroup,
  createBulkMasterUpload,
  previewBulkMasterUpload
} from '../../controllers/admin/travelManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_SUPER_ADMIN, ROLE_TRAVEL_ADMIN, ROLE_DRI_TRAVEL_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_TRAVEL_ADMIN, ROLE_SUPER_ADMIN, ROLE_DRI_TRAVEL_ADMIN));

router.get('/upcoming', CatchAsync(fetchUpcomingBookings));
router.get('/summary', CatchAsync(fetchSummary));
router.get('/driver', CatchAsync(fetchBookingForDriver));

router.post('/booking/status', CatchAsync(updateBookingStatus));
router.post('/transaction/status', CatchAsync(updateTransactionStatus));
router.put('/bookingupdate', CatchAsync(updateBooking));
router.post('/bus-group', CatchAsync(createBusGroup));
router.post('/bus-group/assign-passengers', CatchAsync(assignPassengersToBus));
router.get('/bus-group/:id', CatchAsync(fetchBusGroupDetails));
router.put('/bus-group/coordinator', CatchAsync(setBusCoordinator));
router.get('/bus-groups', CatchAsync(fetchAllBusGroups));
router.get('/available-bookings', CatchAsync(fetchAvailableTravelBookings));
router.delete('/bus-group/passenger/:bookingid', CatchAsync(removePassengerFromBus));
router.put('/bus-group/capacity', CatchAsync(updateBusCapacity));
router.put('/bus-group/:id', CatchAsync(updateBusGroup));
router.post('/bus-group/bulk-assign', CatchAsync(bulkAssignPassengersToBus));
router.post('/bus/preview-bulk-upload', CatchAsync(previewBulkUpload));
router.get('/bus-group/:id/export', CatchAsync(exportBusPassengers));
router.delete('/bus-group/:id', CatchAsync(deleteBusGroup));
router.post('/bus-group/preview-create', CatchAsync(previewCreateBusGroup));
router.post('/bus-group/preview-update', CatchAsync(previewUpdateBusGroup));
router.post('/bulk-master-preview', CatchAsync(previewBulkMasterUpload));
router.post('/bulk-master-create', CatchAsync(createBulkMasterUpload));

export default router;
