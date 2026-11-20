import express from 'express';
import { 
  getWhatsAppStatus, 
  getWhatsAppQr, 
  triggerGroupCreation,
  getGroupReconciliation,
  syncGroupMembers,
  updateGroupSettings
} from '../../controllers/admin/waManagement.controller.js';
import {
  broadcastMessage,
  getSentMessages,
  getFailedJobs,
  retryJob,
  retryAllJobs,
  rescheduleJob,
  cancelJob,
  getTemplates,
  createTemplate,
  deleteTemplate,
  uploadMedia,
  getMedia,
  handleWaUpload
} from '../../controllers/admin/waBroadcast.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { 
  ROLE_SUPER_ADMIN, 
  ROLE_UTSAV_ADMIN, 
  ROLE_ADHYAYAN_ADMIN, 
  ROLE_OFFICE_ADMIN,
  ROLE_ADHYAYAN_READ_ONLY,
  ROLE_UTSAV_READ_ONLY
} from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(auth);

// Group Reconciliation Audit (Allowed for Read-Only roles as well)
router.get(
  '/groups/:groupJid/reconciliation',
  authorizeRoles(
    ROLE_SUPER_ADMIN, 
    ROLE_UTSAV_ADMIN, 
    ROLE_ADHYAYAN_ADMIN, 
    ROLE_OFFICE_ADMIN,
    ROLE_ADHYAYAN_READ_ONLY,
    ROLE_UTSAV_READ_ONLY
  ),
  CatchAsync(getGroupReconciliation)
);

// Full Admin Operations
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ROLE_UTSAV_ADMIN, ROLE_ADHYAYAN_ADMIN, ROLE_OFFICE_ADMIN));

// Connection Status & QR Code
router.get('/status', CatchAsync(getWhatsAppStatus));
router.get('/qr', CatchAsync(getWhatsAppQr));

// Manual Group Creation Queue
router.post('/groups/trigger-create', CatchAsync(triggerGroupCreation));

// Member Sync & Group Settings
router.post('/groups/:groupJid/sync', CatchAsync(syncGroupMembers));
router.post('/groups/:groupJid/settings', CatchAsync(updateGroupSettings));

// Broadcast, history, templates, uploads, job retry/reschedule/cancel
router.post('/broadcast', CatchAsync(broadcastMessage));
router.get('/messages', CatchAsync(getSentMessages));
router.get('/jobs/failed', CatchAsync(getFailedJobs));
router.post('/jobs/retry-all', CatchAsync(retryAllJobs));
router.post('/jobs/retry/:id', CatchAsync(retryJob));
router.post('/jobs/:id/reschedule', CatchAsync(rescheduleJob));
router.delete('/jobs/:id/cancel', CatchAsync(cancelJob));
router.get('/templates', CatchAsync(getTemplates));
router.post('/templates', CatchAsync(createTemplate));
router.delete('/templates/:id', CatchAsync(deleteTemplate));
router.post('/upload', handleWaUpload, CatchAsync(uploadMedia));
router.get('/media/:filename', CatchAsync(getMedia));

export default router;
