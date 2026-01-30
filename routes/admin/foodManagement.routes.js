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
  fetchBulkBookings,
  addBulkMenu,
  editBulkBooking,
  updatePlateIssued,
  foodReportDetailsGuests,
  cancelMultipleMeals,
  bulkIssuePlate
  } from '../../controllers/admin/foodManagement.controller.js';
import { ROLE_SUPER_ADMIN, ROLE_FOOD_ADMIN, ROLE_SMILESTONES_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ROLE_FOOD_ADMIN, ROLE_SMILESTONES_ADMIN));

router.post('/issue/:cardno', CatchAsync(issuePlate));
router.post('/issue/bulk', CatchAsync(bulkIssuePlate));
router.post('/physicalPlates', CatchAsync(physicalPlatesIssued));
router.get('/physicalPlates', CatchAsync(fetchPhysicalPlateIssued));
router.get('/fetch_food_bookings', CatchAsync(fetchFoodBookings));

router.post('/book', CatchAsync(bookFood));
router.put('/cancel/:bookingid', CatchAsync(cancelBooking));
router.put('/cancel_multiple', CatchAsync(cancelMultipleMeals));

router.post('/bulk_booking', CatchAsync(bulkBooking));
router.get('/bulk_booking', CatchAsync(fetchBulkBookings));
router.put('/edit_bulk_booking/:bookingid', CatchAsync(editBulkBooking));
router.put('/update_plate_issued/:bookingid', CatchAsync(updatePlateIssued));

router.get('/report', CatchAsync(foodReport));
router.get('/report_details', CatchAsync(foodReportDetails));
router.get('/report_details_guests', CatchAsync(foodReportDetailsGuests));

router.get('/menu', CatchAsync(fetchMenu));
router.post('/menu', CatchAsync(addMenu));
router.put('/menu', CatchAsync(updateMenu));
router.delete('/menu', CatchAsync(deleteMenu));
router.post('/menu/bulk', CatchAsync(addBulkMenu));


export default router;
