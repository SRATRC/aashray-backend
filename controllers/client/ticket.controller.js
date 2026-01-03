import Ticket from '../../models/ticket.model.js';
import TicketMessage from '../../models/ticket_message.model.js';
import ApiError from '../../utils/ApiError.js';
import { MSG_UPDATE_SUCCESSFUL } from '../../config/constants.js';
import crypto from 'crypto';
import ticketStreamManager from '../../utils/ticketStreamManager.js';

export const createTicket = async (req, res) => {
  const { service, description, os, app_version } = req.body;
  const { cardno } = req.user;

  if (!service || !description) {
    throw new ApiError(400, 'Service and description are required');
  }

  await Ticket.create({
    id: generateTicketId(),
    issued_by: cardno,
    service,
    description,
    os,
    app_version
  });

  res.status(201).send({
    message: 'Successfully created ticket'
  });
};

export const getTickets = async (req, res) => {
  const { cardno } = req.user;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  const tickets = await Ticket.findAll({
    where: { issued_by: cardno },
    order: [['createdAt', 'DESC']],
    offset,
    limit: pageSize
  });

  res.status(200).send({
    message: MSG_FETCH_SUCCESSFUL,
    data: tickets
  });
};

export const getTicketDetails = async (req, res) => {
  const { ticket_id } = req.params;
  const { cardno } = req.user;

  const ticket = await Ticket.findOne({
    where: { id: ticket_id, issued_by: cardno },
    include: [
      {
        model: TicketMessage,
        as: 'messages',
        order: [['createdAt', 'ASC']]
      }
    ]
  });

  if (!ticket) {
    throw new ApiError(404, 'Ticket not found');
  }

  res.status(200).send({
    message: MSG_FETCH_SUCCESSFUL,
    data: ticket
  });
};

export const streamTicketMessages = async (req, res) => {
  const { ticket_id } = req.params;
  const { cardno } = req.user;

  const ticket = await Ticket.findOne({
    where: { id: ticket_id, issued_by: cardno }
  });

  if (!ticket) {
    throw new ApiError(404, 'Ticket not found');
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Add client to manager
  ticketStreamManager.addClient(ticket_id, res, 'user');

  // Initial connection message (optional, but good for testing)
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
};

export const addMessage = async (req, res) => {
  const { ticket_id } = req.params;
  const { message } = req.body;
  const { cardno } = req.user;

  if (!message) {
    throw new ApiError(400, 'Message is required');
  }

  const ticket = await Ticket.findOne({
    where: { id: ticket_id, issued_by: cardno }
  });
  if (!ticket) {
    throw new ApiError(404, 'Ticket not found');
  }

  if (ticket.status === 'closed') {
    throw new ApiError(400, 'Cannot reply to a closed ticket');
  }

  const newMessage = await TicketMessage.create({
    ticket_id,
    sender_id: cardno,
    sender_type: 'user',
    message
  });

  ticketStreamManager.broadcastMessage(ticket_id, newMessage);

  // If ticket was resolved, move back to in progress since user is replying
  const updates = { updatedBy: cardno };
  if (ticket.status === 'resolved') {
    updates.status = 'in progress';
  }

  await ticket.update(updates);

  res.status(201).send({
    message: MSG_UPDATE_SUCCESSFUL
  });
};

export const resolveTicket = async (req, res) => {
  const { ticket_id } = req.params;
  const { cardno } = req.user;

  const ticket = await Ticket.findOne({
    where: { id: ticket_id, issued_by: cardno }
  });

  if (!ticket) {
    throw new ApiError(404, 'Ticket not found');
  }

  if (ticket.status === 'closed') {
    throw new ApiError(400, 'Ticket is already closed');
  }

  await ticket.update({
    status: 'closed',
    updatedBy: cardno
  });

  res.status(200).send({
    message: MSG_UPDATE_SUCCESSFUL
  });
};

const generateTicketId = () => {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
};
