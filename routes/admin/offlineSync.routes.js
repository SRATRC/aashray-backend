import express from 'express';
const router = express.Router();
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import CatchAsync from '../../utils/CatchAsync.js';
import {
  ROLE_SUPER_ADMIN,
  ROLE_ROOM_ADMIN,
  ROLE_KIOSK_ADMIN,
  ROLE_FOOD_ADMIN,
  ROLE_FOOD_PLATE_ADMIN,
  ROLE_SMILESTONES_ADMIN,
  ROLE_OFFICE_ADMIN,
  ROLE_ADHYAYAN_ADMIN,
  ROLE_KOL_ADHYAYAN_ADMIN,
  ROLE_RAJ_ADHYAYAN_ADMIN,
  ROLE_DHU_ADHYAYAN_ADMIN,
  ROLE_ADHYAYAN_READ_ONLY,
  ROLE_GATE_ADMIN,
  ROLE_UTSAV_ADMIN,
  ROLE_UTSAV_READ_ONLY,
  ROLE_UTSAV_ADMIN_RAJ
} from '../../config/constants.js';
import {
  getFoodSnapshot,
  getAdhyayanSnapshotController,
  getGateSnapshot,
  getUtsavSnapshotController,
  getKioskSnapshot,
  getPinHash,
  syncKiosk
} from '../../controllers/admin/offlineSync.controller.js';

// Specific role authorizers
const authorizeFood = authorizeRoles(
  ROLE_SUPER_ADMIN,
  ROLE_FOOD_ADMIN,
  ROLE_FOOD_PLATE_ADMIN,
  ROLE_SMILESTONES_ADMIN
);

const authorizeAdhyayan = authorizeRoles(
  ROLE_SUPER_ADMIN,
  ROLE_OFFICE_ADMIN,
  ROLE_ADHYAYAN_ADMIN,
  ROLE_KOL_ADHYAYAN_ADMIN,
  ROLE_RAJ_ADHYAYAN_ADMIN,
  ROLE_DHU_ADHYAYAN_ADMIN,
  ROLE_ADHYAYAN_READ_ONLY
);

const authorizeGate = authorizeRoles(ROLE_SUPER_ADMIN, ROLE_GATE_ADMIN);

const authorizeUtsav = authorizeRoles(
  ROLE_SUPER_ADMIN,
  ROLE_UTSAV_ADMIN,
  ROLE_UTSAV_READ_ONLY,
  ROLE_UTSAV_ADMIN_RAJ
);

const authorizeKiosk = authorizeRoles(
  ROLE_SUPER_ADMIN,
  ROLE_ROOM_ADMIN,
  ROLE_KIOSK_ADMIN
);

// All routes require valid auth token
router.use(auth);

// Snapshot endpoints
router.get('/food/today', authorizeFood, CatchAsync(getFoodSnapshot));
router.get('/adhyayan/:shibir_id?', authorizeAdhyayan, CatchAsync(getAdhyayanSnapshotController));
router.get('/gate/cards', authorizeGate, CatchAsync(getGateSnapshot));
router.get('/utsav/:utsavid?', authorizeUtsav, CatchAsync(getUtsavSnapshotController));
router.get('/kiosk/today', authorizeKiosk, CatchAsync(getKioskSnapshot));
router.get('/pin-hash', CatchAsync(getPinHash));

// Batch sync for room kiosk
router.post('/kiosk/sync', authorizeKiosk, CatchAsync(syncKiosk));

export default router;
