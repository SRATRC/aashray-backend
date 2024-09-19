import express from 'express';
const router = express.Router();
import {
  generatePassword,
  getPassword
} from '../../controllers/wifi/wifi.controller.js';
import { validateCard } from '../../middleware/validate.js';
import catchAsync from '../../utils/CatchAsync.js';

router.get('/', validateCard, catchAsync(getPassword));
router.get('/generate', validateCard, catchAsync(generatePassword));

export default router;
