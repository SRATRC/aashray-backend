import express from 'express';
const router = express.Router();
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import {
  issuePlate,
  physicalPlatesIssued,
  fetchPhysicalPlateIssued,
  foodReport,
  foodReportDetails,
  fetchMenu,
  updateMenu,
  deleteMenu,
  addMenu,
  bookFood,
  fetchFoodBookings,
  cancelBooking,
  bulkBooking,
  cancelBulkBooking
} from '../../controllers/admin/foodManagement.controller.js';
import { ROLE_SUPER_ADMIN, ROLE_FOOD_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ROLE_FOOD_ADMIN));

router.post('/issue/:cardno', CatchAsync(issuePlate));
router.post('/physicalPlates', CatchAsync(physicalPlatesIssued));
router.get('/physicalPlates', CatchAsync(fetchPhysicalPlateIssued));
router.get('/fetch_food_bookings', CatchAsync(fetchFoodBookings));

router.post('/book', CatchAsync(bookFood));
router.put('/cancel/:bookingid', CatchAsync(cancelBooking));

router.post('/bulk_booking', CatchAsync(bulkBooking));
router.put('/cancel_bulk_booking/:bookingid', CatchAsync(cancelBulkBooking));

router.get('/report', CatchAsync(foodReport));
router.get('/report_details', CatchAsync(foodReportDetails));

router.get('/menu', CatchAsync(fetchMenu));
router.post('/menu', CatchAsync(addMenu));
router.put('/menu', CatchAsync(updateMenu));
router.delete('/menu', CatchAsync(deleteMenu));

export default router;
