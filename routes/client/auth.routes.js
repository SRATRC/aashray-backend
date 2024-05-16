import express from 'express';
const router = express.Router();
import { VerifyIdentity } from '../../controllers/client/auth.controller.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.get('/verify', CatchAsync(VerifyIdentity));

export default router;
