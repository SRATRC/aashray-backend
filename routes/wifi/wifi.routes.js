import express from 'express';
const router = express.Router();
import {
  generatePassword,
  getPassword
} from '../../controllers/wifi/wifi.controller.js';
import { validateCard } from '../../middleware/validate.js';

router.post('/generate/:cardno', validateCard, generatePassword);
router.get('/get/:cardno', validateCard, getPassword);
export default router;
