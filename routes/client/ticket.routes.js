import express from 'express';
import {
  createTicket,
  getTickets,
  getTicketDetails,
  addMessage
} from '../../controllers/client/ticket.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

const router = express.Router();

router.use(validateCard);

router.post('/', CatchAsync(createTicket));
router.get('/', CatchAsync(getTickets));
router.get('/:id', CatchAsync(getTicketDetails));
router.post('/:id/messages', CatchAsync(addMessage));

export default router;
