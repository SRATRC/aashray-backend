import Ticket from '../../models/ticket.model.js';
import TicketMessage from '../../models/ticket_message.model.js';
import ApiError from '../../utils/ApiError.js';
import {
  MSG_FETCH_SUCCESSFUL,
  MSG_UPDATE_SUCCESSFUL
} from '../../config/constants.js';

// export const getAllTickets = async (req, res) => {
//   const { status, service } = req.query;
//   const where = {};

//   if (status) where.status = status;
//   if (service) where.service = service;

//   const tickets = await Ticket.findAll({
//     where,
//     order: [['createdAt', 'DESC']]
//   });

//   res.status(200).json({
//     status: 'success',
//     message: MSG_FETCH_SUCCESSFUL,
//     data: tickets
//   });
// };
import { Sequelize } from 'sequelize';

export const getAllTickets = async (req, res) => {
  const { status, service } = req.query;
  const where = {};
  if (status) where.status = status;
  if (service) where.service = service;

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
    order: [['createdAt', 'DESC']]
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

  if (ticket.status === 'closed') {
    throw new ApiError(400, 'ticket is closed');
  }

  const newMessage = await TicketMessage.create({
    ticket_id: id,
    sender_id: req.user.username,
    sender_type: 'admin',
    message
  });

  // Update ticket updatedBy and status if needed
  const updates = { updatedBy: req.user.username };
  if (ticket.status === 'open') {
    updates.status = 'in progress';
  }

  await ticket.update(updates);

  res.status(201).json({
    status: 'success',
    message: MSG_UPDATE_SUCCESSFUL,
    data: newMessage
  });
};

export const updateTicketStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const ticket = await Ticket.findByPk(id);
  if (!ticket) {
    throw new ApiError(404, 'Ticket not found');
  }

  await ticket.update({ status, updatedBy: req.user.username });

  res.status(200).json({
    status: 'success',
    message: MSG_UPDATE_SUCCESSFUL,
    data: ticket
  });
};
