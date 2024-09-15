import express from 'express';
const router = express.Router();
import {
  updateProfile,
  transactions
} from '../../controllers/client/profile.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(validateCard);
router.put('/', CatchAsync(updateProfile));
router.get('/transactions', CatchAsync(transactions));

export default router;
