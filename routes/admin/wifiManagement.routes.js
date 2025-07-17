import express from 'express';
const router = express.Router();
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() });

import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_WIFI_ADMIN, ROLE_SUPER_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

import {
  uploadWiFiCodes,
  wifiRecord
} from '../../controllers/admin/wifiManagement.controller.js';
// import catchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ROLE_WIFI_ADMIN));

router.post('/uploadcode', upload.single('file'), CatchAsync(uploadWiFiCodes));
router.get('/wifirecords', CatchAsync(wifiRecord));




export default router;
