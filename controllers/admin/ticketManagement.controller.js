import { Ticket, TicketMessage } from '../../models/associations.js';
import { Sequelize } from 'sequelize';
import {
  MSG_FETCH_SUCCESSFUL,
  MSG_UPDATE_SUCCESSFUL,
  STATUS_INPROGRESS,
  STATUS_OPEN,
  STATUS_CLOSED,
  STATUS_RESOLVED,
  ROLE_SUPER_ADMIN,
  TICKET_SERVICE_ROLE_MAP
} from '../../config/constants.js';
import ticketStreamManager from '../../utils/ticketStreamManager.js';
import ApiError from '../../utils/ApiError.js';
import { notifyCardno } from '../../helpers/notification.helper.js';
import database from '../../config/database.js';
import { attachUserContext } from '../../middleware/Logger.js';

// Admins can only move a ticket to open/in-progress/resolved. Closing is not
// an admin action: the ticket owner closes it themselves (client resolve
// endpoint), or it auto-closes after sitting resolved with no activity
// (see the ticketAutoCloseJob in cron.js) — matching how Zendesk/Freshdesk
// separate "solved" (agent) from "closed" (customer or time-based).
const ALLOWED_TICKET_STATUSES = [STATUS_OPEN, STATUS_INPROGRESS, STATUS_RESOLVED];

// Returns the list of ticket `service` values a given admin (identified by
// their roles) may access, or `null` for superAdmin/unrestricted access.
// Enforced here (not just via the route's authorizeRoles gate) so a
// department admin can't reach another department's tickets simply by
// passing a different `service` query param or ticket id.
//
// Similar in spirit to shortLink.controller.js's TYPE_ROLE_MAP (a type/category
// -> allowed-roles map with the same "role intersection" check) — worth
// consolidating into a shared role-scoping utility if a third feature needs
// this pattern.
function getAllowedServices(roles) {
  if (roles.includes(ROLE_SUPER_ADMIN)) return null;
  const allowed = new Set();
  for (const [service, serviceRoles] of Object.entries(TICKET_SERVICE_ROLE_MAP)) {
    if (serviceRoles.some((r) => roles.includes(r))) allowed.add(service);
  }
  return Array.from(allowed);
}

function assertCanAccessTicket(roles, ticket) {
  const allowedServices = getAllowedServices(roles);
  if (allowedServices !== null && !allowedServices.includes(ticket.service)) {
    throw new ApiError(403, "You are not authorized to access this ticket's service");
  }
}

async function loadTicketOrThrow(id, roles) {
  const ticket = await Ticket.findByPk(id);
  if (!ticket) {
    throw new ApiError(404, 'Ticket not found');
  }
  assertCanAccessTicket(roles, ticket);
  return ticket;
}

export const getAllTickets = async (req, res) => {
  const { status, service } = req.query;
  const allowedServices = getAllowedServices(req.roles);
  const where = {};
  if (status) where.status = status;

  if (allowedServices !== null) {
    if (service && !allowedServices.includes(service)) {
      throw new ApiError(403, "You are not authorized to view this service's tickets");
    }
    where.service = service || { [Sequelize.Op.in]: allowedServices };
  } else if (service) {
    where.service = service;
  }

  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  const tickets = await Ticket.findAll({
    where,
    attributes: {
      include: [
        [
          // `${Ticket.name}` ("Ticket") rather than the table name ("tickets")
          // because Sequelize aliases the base table of a query by its model
          // name by default with no `include`/join present. That default is
          // an undocumented Sequelize behavior this literal has to assume —
          // if this query ever gains an `include`, verify the alias still
          // matches before trusting this subquery's output.
          Sequelize.literal(`(
            SELECT MAX(createdAt)
            FROM ${TicketMessage.getTableName()}
            WHERE ${TicketMessage.getTableName()}.ticket_id = ${Ticket.name}.id
          )`),
          'last_message_at'
        ]
      ]
    },
    order: [['createdAt', 'DESC']],
    offset,
    limit: pageSize
  });

  res.status(200).json({
    status: 'success',
    data: tickets
  });
};

export const getTicketDetails = async (req, res) => {
  const { id } = req.params;

  const ticket = await loadTicketOrThrow(id, req.roles);

  const messages = await TicketMessage.findAll({
    where: { ticket_id: id },
    order: [['createdAt', 'ASC']]
  });

  res.status(200).json({
    status: 'success',
    message: MSG_FETCH_SUCCESSFUL,
    data: { ...ticket.toJSON(), messages }
  });
};

export const streamTicketMessages = async (req, res) => {
  const { id } = req.params;

  await loadTicketOrThrow(id, req.roles);

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Add admin to manager
  ticketStreamManager.addClient(id, res, 'admin');

  // Initial connection message
  res.write(
    `data: ${JSON.stringify({
      type: 'connected',
      user: req.user.username
    })}\n\n`
  );
};

export const adminAddMessage = async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  attachUserContext(req);

  if (!message) {
    throw new ApiError(400, 'Message is required');
  }

  const ticket = await loadTicketOrThrow(id, req.roles);

  if (ticket.status === STATUS_CLOSED) {
    throw new ApiError(400, 'ticket is closed');
  }

  req.log.info('admin_ticket_add_message_start', { admin: req.user.username, ticketId: id });

  const t = await database.transaction();
  req.transaction = t;

  const newMessage = await TicketMessage.create(
    {
      ticket_id: id,
      sender_id: req.user.username,
      sender_type: 'admin',
      message
    },
    { transaction: t }
  );

  // Update ticket updatedBy and status if needed
  const updates = { updatedBy: req.user.username };
  if (ticket.status === STATUS_OPEN) {
    updates.status = STATUS_INPROGRESS;
  }

  await ticket.recordActivity(updates, { transaction: t });

  await t.commit();
  req.transaction = null;

  ticketStreamManager.broadcastMessage(id, newMessage);
  if (updates.status) {
    ticketStreamManager.broadcastStatusUpdate(id, updates.status, req.user.username);
  }

  // Best-effort push notification to the ticket owner. notifyCardno never
  // throws (it catches internally and resolves {success, reason}), so this
  // is intentionally not awaited — genuinely fire-and-forget, not just
  // wrapped in a try/catch, so the reply response doesn't wait on a DB
  // lookup plus an external push API call.
  notifyCardno(ticket.issued_by, {
    title: 'Support ticket update',
    body: `${ticket.service}: you have a new reply`,
    screen: `/support/${ticket.id}`,
    data: { ticketId: ticket.id }
  });

  req.log.info('admin_ticket_add_message_success', { admin: req.user.username, ticketId: id });

  res.status(201).json({
    status: 'success',
    message: MSG_UPDATE_SUCCESSFUL,
    data: newMessage
  });
};

export const updateTicketStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  attachUserContext(req);

  if (!ALLOWED_TICKET_STATUSES.includes(status)) {
    throw new ApiError(400, 'Invalid ticket status');
  }

  const ticket = await loadTicketOrThrow(id, req.roles);

  if (ticket.status === STATUS_CLOSED) {
    throw new ApiError(400, 'Cannot change the status of a closed ticket');
  }

  req.log.info('admin_ticket_status_update_start', {
    admin: req.user.username,
    ticketId: id,
    from: ticket.status,
    to: status
  });

  const t = await database.transaction();
  req.transaction = t;

  await ticket.recordActivity({ status, updatedBy: req.user.username }, { transaction: t });

  await t.commit();
  req.transaction = null;

  ticketStreamManager.broadcastStatusUpdate(id, status, req.user.username);

  // Best-effort push notification to the ticket owner. notifyCardno never
  // throws (it catches internally and resolves {success, reason}), so this
  // is intentionally not awaited — genuinely fire-and-forget, not just
  // wrapped in a try/catch, so the response doesn't wait on a DB lookup plus
  // an external push API call.
  notifyCardno(ticket.issued_by, {
    title: 'Support ticket update',
    body: `Your ticket is now ${status}`,
    screen: `/support/${ticket.id}`,
    data: { ticketId: ticket.id }
  });

  req.log.info('admin_ticket_status_update_success', { admin: req.user.username, ticketId: id });

  res.status(200).json({
    status: 'success',
    message: MSG_UPDATE_SUCCESSFUL,
    data: ticket
  });
};
