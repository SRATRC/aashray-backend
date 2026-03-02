// import express from 'express';
// const router = express.Router();
// import {
//   generatePassword,
//   getPassword,
//   requestPermanentCode,
//   fetchPermanentCodes,
//   resetPermanentCode,
//   deletePermanentCode
// } from '../../controllers/wifi/wifi.controller.js';
// import { validateCard } from '../../middleware/validate.js';
// import catchAsync from '../../utils/CatchAsync.js';

// router.get('/', validateCard, catchAsync(getPassword));
// router.get('/generate', validateCard, catchAsync(generatePassword));
// router.post('/permanent', validateCard, catchAsync(requestPermanentCode));
// router.get('/permanent', validateCard, catchAsync(fetchPermanentCodes));
// router.post('/permanent/reset', validateCard, catchAsync(resetPermanentCode));
// router.delete('/permanent', validateCard, catchAsync(deletePermanentCode));

// export default router;

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