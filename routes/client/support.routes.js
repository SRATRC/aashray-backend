import express from 'express';
const router = express.Router();
import { createTicket } from '../../controllers/client/support.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(validateCard);

router.post('/', CatchAsync(createTicket));

export default router;
