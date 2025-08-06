import express from 'express';
const router = express.Router();
import { checkForUpdates } from '../../controllers/client/updates.controller.js';
import catchAsync from '../../utils/CatchAsync.js';

router.get('/', catchAsync(checkForUpdates));

export default router;
