import express from 'express';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_SUPER_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';
import {
  createSession,
  bulkCreateSessions,
  listSessions,
  updateSession,
  deleteSession,
  moveSession,
  shiftSessions,
  getConfig,
  updateConfig,
  getTodaySession
} from '../../controllers/admin/satshrutSession.controller.js';

const router = express.Router();

// All satshrut routes require admin auth + superAdmin role
router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN));

// Session management
router.post('/session/bulk', CatchAsync(bulkCreateSessions));  // before /:id routes
router.post('/session/move', CatchAsync(moveSession));
router.post('/session/shift', CatchAsync(shiftSessions));
router.post('/session', CatchAsync(createSession));
router.get('/sessions', CatchAsync(listSessions));
router.patch('/session/:id', CatchAsync(updateSession));
router.delete('/session/:id', CatchAsync(deleteSession));

// Global audio config
router.get('/config', CatchAsync(getConfig));
router.put('/config', CatchAsync(updateConfig));

// Player endpoint — get today's (or a specific date's) session with merged audio config
router.get('/today', CatchAsync(getTodaySession));

export default router;
