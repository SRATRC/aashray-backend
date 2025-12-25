import express from 'express';
const router = express.Router();
import {
  generateTempCode,
  fetchTempCodes,
  requestPermanentCode,
  fetchPermanentCodes,
  resetPermanentCode
} from '../../controllers/wifi/wifi.controller.js';
import { validateCard } from '../../middleware/validate.js';
import catchAsync from '../../utils/CatchAsync.js';

router.get('/', validateCard, catchAsync(fetchTempCodes));
router.get('/generate', validateCard, catchAsync(generateTempCode));
router.post('/permanent', validateCard, catchAsync(requestPermanentCode));
router.get('/permanent', validateCard, catchAsync(fetchPermanentCodes));
router.post('/permanent/reset', validateCard, catchAsync(resetPermanentCode));

export default router;
