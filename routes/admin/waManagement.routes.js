import express from 'express';
import { 
  getWhatsAppStatus, 
  getWhatsAppQr, 
  broadcastMessage,
  getFailedJobs,
  retryJob,
  retryAllJobs,
  triggerGroupCreation,
  getSentMessages,
  getTemplates,
  createTemplate,
  deleteTemplate,
  uploadMedia,
  getGroupReconciliation,
  syncGroupMembers,
  rescheduleJob,
  cancelJob
} from '../../controllers/admin/waManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_SUPER_ADMIN, ROLE_UTSAV_ADMIN, ROLE_ADHYAYAN_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

// Ensure upload directory exists
const uploadDir = path.join(process.cwd(), 'public/uploads/whatsapp');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({ storage });

const router = express.Router();

// Apply auth middleware to all routes
router.use(auth);

// Authorize roles for these operations
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ROLE_UTSAV_ADMIN, ROLE_ADHYAYAN_ADMIN));

router.get('/status', CatchAsync(getWhatsAppStatus));
router.get('/qr', CatchAsync(getWhatsAppQr));
router.post('/broadcast', CatchAsync(broadcastMessage));
router.get('/messages', CatchAsync(getSentMessages));

router.get('/jobs/failed', CatchAsync(getFailedJobs));
router.post('/jobs/retry/:id', CatchAsync(retryJob));
router.post('/jobs/retry-all', CatchAsync(retryAllJobs));

router.post('/groups/trigger-create', CatchAsync(triggerGroupCreation));

// WhatsApp Templates
router.get('/templates', CatchAsync(getTemplates));
router.post('/templates', CatchAsync(createTemplate));
router.delete('/templates/:id', CatchAsync(deleteTemplate));

// Media Uploads
router.post('/upload', upload.single('file'), CatchAsync(uploadMedia));

// Group Reconciliation & Sync
router.get('/groups/:groupJid/reconciliation', CatchAsync(getGroupReconciliation));
router.post('/groups/:groupJid/sync', CatchAsync(syncGroupMembers));

// Reschedule & Cancel Jobs
router.post('/jobs/:id/reschedule', CatchAsync(rescheduleJob));
router.delete('/jobs/:id/cancel', CatchAsync(cancelJob));

export default router;
