import express from 'express';
import {
  getAllTickets,
  getTicketDetails,
  adminAddMessage,
  updateTicketStatus
} from '../../controllers/admin/ticketManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import {
  ROLE_SUPER_ADMIN,
  ROLE_MAINTENANCE_ADMIN
} from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

const router = express.Router();

router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ROLE_MAINTENANCE_ADMIN));

router.get('/', CatchAsync(getAllTickets));
router.get('/:id', CatchAsync(getTicketDetails));
router.post('/:id/messages', CatchAsync(adminAddMessage));
router.patch('/:id/status', CatchAsync(updateTicketStatus));

export default router;
