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
import { ROLE_SUPER_ADMIN, ROLE_FOOD_ADMIN, ROLE_SMILESTONES_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ROLE_FOOD_ADMIN, ROLE_SMILESTONES_ADMIN));

// Server-side enforcement for restricted users
router.use((req, res, next) => {
  if (req.user && req.user.username === 'bikram.thapa') {
    const cleanPath = req.path.replace(/\/$/, '');
    if (cleanPath !== '/physicalPlates') {
      req.log.warn('restricted_user_access_blocked', { username: req.user.username, path: req.path });
      return res.status(403).json({ message: 'Access denied: User restricted to K1 Kitchen Count only' });
    }
  }
  next();
});

router.post('/issue/bulk', CatchAsync(bulkIssuePlate));
router.post('/issue/:cardno', CatchAsync(issuePlate));
router.post('/physicalPlates', CatchAsync(physicalPlatesIssued));
router.get('/physicalPlates', CatchAsync(fetchPhysicalPlateIssued));
router.put('/physicalPlates', CatchAsync(updatePhysicalPlate));
router.get('/fetch_food_bookings', CatchAsync(fetchFoodBookings));
router.post("/meal-count", CatchAsync(getMealCountByMobile));

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
