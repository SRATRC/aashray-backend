import express from 'express';
import {
  createTicket,
  getTickets,
  getTicketDetails,
  addMessage,
  resolveTicket,
  streamTicketMessages,
  presignAttachments,
  serveAttachment
} from '../../controllers/client/ticket.controller.js';
import { validateCard } from '../../middleware/validate.js';
import CatchAsync from '../../utils/CatchAsync.js';

const router = express.Router();

router.use(validateCard);

// Static /attachments/presign must be registered before the /:ticket_id param
// routes so "attachments" isn't captured as a ticket id (same ordering care as
// the /:ticket_id/stream route).
router.post('/attachments/presign', CatchAsync(presignAttachments));

router.post('/', CatchAsync(createTicket));
router.get('/', CatchAsync(getTickets));
router.get('/:ticket_id/stream', CatchAsync(streamTicketMessages));
router.get('/:ticket_id/attachments/:attachmentId', CatchAsync(serveAttachment));
router.get('/:ticket_id', CatchAsync(getTicketDetails));
router.post('/:ticket_id/messages', CatchAsync(addMessage));
router.patch('/:ticket_id/resolve', CatchAsync(resolveTicket));

export default router;
