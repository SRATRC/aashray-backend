import express from 'express';
const router = express.Router();
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import {
  issuePlate,
  physicalPlatesIssued,
  fetchPhysicalPlateIssued,
  updatePhysicalPlate,
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
  bulkIssuePlate,
  getMealCountByMobile
  } from '../../controllers/admin/foodManagement.controller.js';
import { ROLE_SUPER_ADMIN, ROLE_FOOD_ADMIN, ROLE_SMILESTONES_ADMIN, ROLE_FOOD_PLATE_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);

// Group 1: K1 Kitchen Count physical plate actions (accessible by superAdmin, foodAdmin, and foodPlateAdmin)
const authorizePlateAccess = authorizeRoles(ROLE_SUPER_ADMIN, ROLE_FOOD_ADMIN, ROLE_FOOD_PLATE_ADMIN);

router.post('/physicalPlates', authorizePlateAccess, CatchAsync(physicalPlatesIssued));
router.get('/physicalPlates', authorizePlateAccess, CatchAsync(fetchPhysicalPlateIssued));
router.put('/physicalPlates', authorizePlateAccess, CatchAsync(updatePhysicalPlate));

// Group 2: All other food operations (only accessible by superAdmin, foodAdmin, smilesAdmin)
const authorizeFoodAdmin = authorizeRoles(ROLE_SUPER_ADMIN, ROLE_FOOD_ADMIN, ROLE_SMILESTONES_ADMIN);

router.post('/issue/bulk', authorizeFoodAdmin, CatchAsync(bulkIssuePlate));
router.post('/issue/:cardno', authorizeFoodAdmin, CatchAsync(issuePlate));
router.get('/fetch_food_bookings', authorizeFoodAdmin, CatchAsync(fetchFoodBookings));
router.post("/meal-count", authorizeFoodAdmin, CatchAsync(getMealCountByMobile));

router.post('/book', authorizeFoodAdmin, CatchAsync(bookFood));
router.put('/cancel/:bookingid', authorizeFoodAdmin, CatchAsync(cancelBooking));
router.put('/cancel_multiple', authorizeFoodAdmin, CatchAsync(cancelMultipleMeals));

router.post('/bulk_booking', authorizeFoodAdmin, CatchAsync(bulkBooking));
router.get('/bulk_booking', authorizeFoodAdmin, CatchAsync(fetchBulkBookings));
router.put('/edit_bulk_booking/:bookingid', authorizeFoodAdmin, CatchAsync(editBulkBooking));
router.put('/update_plate_issued/:bookingid', authorizeFoodAdmin, CatchAsync(updatePlateIssued));

router.get('/report', authorizeFoodAdmin, CatchAsync(foodReport));
router.get('/report_details', authorizeFoodAdmin, CatchAsync(foodReportDetails));
router.get('/report_details_guests', authorizeFoodAdmin, CatchAsync(foodReportDetailsGuests));

router.get('/menu', authorizeFoodAdmin, CatchAsync(fetchMenu));
router.post('/menu', authorizeFoodAdmin, CatchAsync(addMenu));
router.put('/menu', authorizeFoodAdmin, CatchAsync(updateMenu));
router.delete('/menu', authorizeFoodAdmin, CatchAsync(deleteMenu));
router.post('/menu/bulk', authorizeFoodAdmin, CatchAsync(addBulkMenu));

export default router;
