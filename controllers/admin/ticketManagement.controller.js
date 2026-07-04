import { Ticket, TicketMessage } from '../../models/associations.js';
import { Sequelize } from 'sequelize';
import {
  MSG_FETCH_SUCCESSFUL,
  MSG_UPDATE_SUCCESSFUL,
  STATUS_INPROGRESS,
  STATUS_OPEN,
  STATUS_CLOSED,
  STATUS_RESOLVED
} from '../../config/constants.js';

// Admins can only move a ticket to open/in-progress/resolved. Closing is not
// an admin action: the ticket owner closes it themselves (client resolve
// endpoint), or it auto-closes after sitting resolved with no activity
// (see the ticketAutoCloseJob in cron.js) — matching how Zendesk/Freshdesk
// separate "solved" (agent) from "closed" (customer or time-based).
const ALLOWED_TICKET_STATUSES = [STATUS_OPEN, STATUS_INPROGRESS, STATUS_RESOLVED];
import ticketStreamManager from '../../utils/ticketStreamManager.js';
import ApiError from '../../utils/ApiError.js';
import { notifyCardno } from '../../helpers/notification.helper.js';

export const getAllTickets = async (req, res) => {
  const { status, service } = req.query;
  const where = {};
  if (status) where.status = status;
  if (service) where.service = service;

  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  const tickets = await Ticket.findAll({
    where,
    attributes: {
      include: [
        [
          Sequelize.literal(`(
            SELECT MAX(createdAt)
            FROM ticket_messages
            WHERE ticket_messages.ticket_id = Ticket.id
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

  const ticket = await Ticket.findByPk(id);
  if (!ticket) {
    throw new ApiError(404, 'Ticket not found');
  }

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

  const ticket = await Ticket.findByPk(id);
  if (!ticket) {
    throw new ApiError(404, 'Ticket not found');
  }

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

  if (!message) {
    throw new ApiError(400, 'Message is required');
  }

  const ticket = await Ticket.findByPk(id);
  if (!ticket) {
    throw new ApiError(404, 'Ticket not found');
  }

  if (ticket.status === STATUS_CLOSED) {
    throw new ApiError(400, 'ticket is closed');
  }

  const newMessage = await TicketMessage.create({
    ticket_id: id,
    sender_id: req.user.username,
    sender_type: 'admin',
    message
  });

  ticketStreamManager.broadcastMessage(id, newMessage);

  // Update ticket updatedBy and status if needed
  const updates = { updatedBy: req.user.username };
  if (ticket.status === STATUS_OPEN) {
    updates.status = STATUS_INPROGRESS;
  }

  await ticket.update(updates);

  if (updates.status) {
    ticketStreamManager.broadcastStatusUpdate(id, updates.status, req.user.username);
  }

  // Best-effort push notification to the ticket owner; never blocks the reply.
  try {
    await notifyCardno(ticket.issued_by, {
      title: 'Support ticket update',
      body: `${ticket.service}: you have a new reply`,
      screen: `/support/${ticket.id}`,
      data: { ticketId: ticket.id }
    });
  } catch (e) {
    // notification is best-effort
  }

  res.status(201).json({
    status: 'success',
    message: MSG_UPDATE_SUCCESSFUL,
    data: newMessage
  });
};

export const updateTicketStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!ALLOWED_TICKET_STATUSES.includes(status)) {
    throw new ApiError(400, 'Invalid ticket status');
  }

  const ticket = await Ticket.findByPk(id);
  if (!ticket) {
    throw new ApiError(404, 'Ticket not found');
  }

  await ticket.update({ status, updatedBy: req.user.username });

  ticketStreamManager.broadcastStatusUpdate(id, status, req.user.username);

  // Best-effort push notification to the ticket owner; never blocks the reply.
  try {
    await notifyCardno(ticket.issued_by, {
      title: 'Support ticket update',
      body: `Your ticket is now ${status}`,
      screen: `/support/${ticket.id}`,
      data: { ticketId: ticket.id }
    });
  } catch (e) {
    // notification is best-effort
  }

  res.status(200).json({
    status: 'success',
    message: MSG_UPDATE_SUCCESSFUL,
    data: ticket
  });
};
