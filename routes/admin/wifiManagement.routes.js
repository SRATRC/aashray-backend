import express from 'express';
const router = express.Router();

import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_WIFI_ADMIN, ROLE_SUPER_ADMIN } from '../../config/constants.js';
import {
  uploadWiFiCodes,
  wifiRecord,
  getPermanentCodeRequests,
  updatePermanentCodeRequest
} from '../../controllers/admin/wifiManagement.controller.js';
import CatchAsync from '../../utils/CatchAsync.js';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() });

router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ROLE_WIFI_ADMIN));

router.post('/uploadcode', upload.single('file'), CatchAsync(uploadWiFiCodes));
router.get('/wifirecords', CatchAsync(wifiRecord));
router.get('/permanent', CatchAsync(getPermanentCodeRequests));
router.put('/permanent/:requestId', CatchAsync(updatePermanentCodeRequest));

export default router;
