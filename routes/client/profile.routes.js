import express from 'express';
const router = express.Router();
import {
  updateProfile,
  upload,
  transactions,
  sendNotification,
  fetchProfile
} from '../../controllers/client/profile.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(validateCard);
router.get('/', CatchAsync(fetchProfile));
router.put('/', CatchAsync(updateProfile));
router.post('/upload', CatchAsync(upload));
router.get('/transactions', CatchAsync(transactions));
router.post('/notification', CatchAsync(sendNotification));

export default router;
