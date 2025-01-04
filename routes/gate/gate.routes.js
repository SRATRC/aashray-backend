import express from 'express';
const router = express.Router();
import { gateEntry, gateExit, guestList } from '../../controllers/gate/gate.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.post('/entry/:cardno', validateCard, CatchAsync(gateEntry));
router.post('/exit/:cardno', validateCard, CatchAsync(gateExit));
router.get('/guestList/', CatchAsync(guestList));
export default router;
