
console.log('Coordinator auth routes loaded');
import express from 'express';

const router = express.Router();

import CatchAsync from '../../utils/CatchAsync.js';

import {
  sendOtp,
  verifyOtp,
  fetchCoordinatorDashboard,
  updateBoardingStatus,
} from '../../controllers/admin/coordinatorAuth.controller.js';

router.post(
  '/send-otp',
  CatchAsync(sendOtp)
);

router.post(
  '/verify-otp',
  CatchAsync(verifyOtp)
);

router.get(
  '/dashboard',
  CatchAsync(
    fetchCoordinatorDashboard
  )
);

router.put(
  '/boarding-status',
  CatchAsync(
    updateBoardingStatus
  )
);

export default router;