import express from 'express';
import {
  getAllTickets,
  getTicketDetails,
  adminAddMessage,
  updateTicketStatus,
  streamTicketMessages
} from '../../controllers/admin/ticketManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_SUPER_ADMIN, TICKET_SERVICE_ROLE_MAP } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

const router = express.Router();

// Route-level gate: anyone holding superAdmin or any department role mapped
// to at least one ticket service may reach these endpoints at all. Which
// specific tickets/services they can actually see is enforced per-request
// inside the controller (see getAllowedServices/assertCanAccessTicket in
// ticketManagement.controller.js) — this list alone is not sufficient
// authorization for a specific ticket.
const TICKET_DEPARTMENT_ROLES = [...new Set(Object.values(TICKET_SERVICE_ROLE_MAP).flat())];

router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ...TICKET_DEPARTMENT_ROLES));

router.get('/', CatchAsync(getAllTickets));
router.get('/:id/stream', CatchAsync(streamTicketMessages));
router.get('/:id', CatchAsync(getTicketDetails));
router.post('/:id/messages', CatchAsync(adminAddMessage));
router.patch('/:id/status', CatchAsync(updateTicketStatus));

export default router;
