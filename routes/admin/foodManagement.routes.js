import express from 'express';
const router = express.Router();
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import {
  issuePlate,
  physicalPlatesIssued,
  fetchPhysicalPlateIssued,
  bookFoodForMumukshu,
  cancelFoodByCard,
  cancelFoodByMob,
  bookFoodForGuest,
  cancelFoodForGuest,
  foodReport,
  foodReportDetails
} from '../../controllers/admin/foodManagement.controller.js';
import { ROLE_SUPER_ADMIN, ROLE_FOOD_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ROLE_FOOD_ADMIN));

router.post('/issue/:cardno', CatchAsync(issuePlate));
router.post('/physicalPlates', CatchAsync(physicalPlatesIssued));
router.get('/physicalPlates', CatchAsync(fetchPhysicalPlateIssued));
router.post('/book', CatchAsync(bookFoodForMumukshu));
router.put('/cancelCard', CatchAsync(cancelFoodByCard));
router.put('/cancelMob', CatchAsync(cancelFoodByMob));
router.post('/guest', CatchAsync(bookFoodForGuest));
router.put('/guest', CatchAsync(cancelFoodForGuest));
router.get('/report', CatchAsync(foodReport));
router.get('/report_details', CatchAsync(foodReportDetails));

export default router;
