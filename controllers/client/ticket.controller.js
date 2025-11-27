import Ticket from '../../models/ticket.model.js';
import TicketMessage from '../../models/ticket_message.model.js';
import ApiError from '../../utils/ApiError.js';
import {
  MSG_FETCH_SUCCESSFUL,
  MSG_BOOKING_SUCCESSFUL,
  MSG_UPDATE_SUCCESSFUL
} from '../../config/constants.js';

export const createTicket = async (req, res) => {
  const { service, description, os, app_version } = req.body;
  const { cardno } = req.user;

  if (!service || !description) {
    throw new ApiError(400, 'Service and description are required');
  }

  const ticket = await Ticket.create({
    issued_by: cardno,
    service,
    description,
    os,
    app_version,
    updatedBy: cardno
  });

  res.status(201).json({
    status: 'success',
    message: MSG_BOOKING_SUCCESSFUL,
    data: ticket
  });
};

export const getTickets = async (req, res) => {
  const { cardno } = req.user;

  const tickets = await Ticket.findAll({
    where: { issued_by: cardno },
    order: [['createdAt', 'DESC']]
  });

  res.status(200).json({
    status: 'success',
    message: MSG_FETCH_SUCCESSFUL,
    data: tickets
  });
};

export const getTicketDetails = async (req, res) => {
  const { id } = req.params;
  const { cardno } = req.user;

  const ticket = await Ticket.findOne({
    where: { id, issued_by: cardno },
    include: [
      {
        model: TicketMessage,
        as: 'messages', // Note: We need to define associations
        order: [['createdAt', 'ASC']]
      }
    ]
  });

  if (!ticket) {
    throw new ApiError(404, 'Ticket not found');
  }

  // Fetch messages separately if association issue persists, but ideally association should work.
  // For now, let's assume we'll add association in a separate step or here.
  // Actually, let's fetch messages manually to be safe if associations aren't set up in models yet.
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

export const addMessage = async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  const { cardno } = req.user;

  if (!message) {
    throw new ApiError(400, 'Message is required');
  }

  const ticket = await Ticket.findOne({ where: { id, issued_by: cardno } });
  if (!ticket) {
    throw new ApiError(404, 'Ticket not found');
  }

  const newMessage = await TicketMessage.create({
    ticket_id: id,
    sender_id: cardno,
    sender_type: 'user',
    message
  });

  // Update ticket updatedBy and updatedAt
  await ticket.update({ updatedBy: cardno });

  res.status(201).json({
    status: 'success',
    message: MSG_UPDATE_SUCCESSFUL,
    data: newMessage
  });
};
