import express from 'express';
const router = express.Router();
import { gateEntry, gateExit } from '../../controllers/gate/gate.controller.js';
import { validateCard } from '../../middleware/validate.js';

router.post('/entry/:cardno', validateCard, gateEntry);
router.post('/exit/:cardno', validateCard, gateExit);
export default router;
