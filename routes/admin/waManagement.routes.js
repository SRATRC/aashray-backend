import express from 'express';
import { 
  getWhatsAppStatus, 
  getWhatsAppQr, 
  triggerGroupCreation,
  getGroupReconciliation,
  syncGroupMembers,
  updateGroupSettings
} from '../../controllers/admin/waManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_SUPER_ADMIN, ROLE_UTSAV_ADMIN, ROLE_ADHYAYAN_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(auth);

// Authorize roles for these operations
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ROLE_UTSAV_ADMIN, ROLE_ADHYAYAN_ADMIN));

// Connection Status & QR Code
router.get('/status', CatchAsync(getWhatsAppStatus));
router.get('/qr', CatchAsync(getWhatsAppQr));

// Manual Group Creation Queue
router.post('/groups/trigger-create', CatchAsync(triggerGroupCreation));

// Group Reconciliation & Sync Audit
router.get('/groups/:groupJid/reconciliation', CatchAsync(getGroupReconciliation));
router.post('/groups/:groupJid/sync', CatchAsync(syncGroupMembers));
router.post('/groups/:groupJid/settings', CatchAsync(updateGroupSettings));

export default router;
