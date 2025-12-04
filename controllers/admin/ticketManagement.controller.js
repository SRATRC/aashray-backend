import Ticket from '../../models/ticket.model.js';
import TicketMessage from '../../models/ticket_message.model.js';
import ApiError from '../../utils/ApiError.js';
import {
  MSG_FETCH_SUCCESSFUL,
  MSG_UPDATE_SUCCESSFUL
} from '../../config/constants.js';

export const getAllTickets = async (req, res) => {
  const { status, service } = req.query;
  const where = {};

  if (status) where.status = status;
  if (service) where.service = service;

  const tickets = await Ticket.findAll({
    where,
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
  const { id: adminId } = req.user; // Assuming admin ID is in req.user

  if (!message) {
    throw new ApiError(400, 'Message is required');
  }

  const ticket = await Ticket.findByPk(id);
  if (!ticket) {
    throw new ApiError(404, 'Ticket not found');
  }

  if (ticket.status === 'closed') {
    throw new ApiError(400, 'Cannot reply to a closed ticket');
  }

  const newMessage = await TicketMessage.create({
    ticket_id: id,
    sender_id: adminId, // Or admin name/email
    sender_type: 'admin',
    message
  });

  // Update ticket updatedBy and status if needed
  const updates = { updatedBy: `Admin-${adminId}` };
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
  const { status, admin_comments } = req.body;
  const { id: adminId } = req.user;

  const ticket = await Ticket.findByPk(id);
  if (!ticket) {
    throw new ApiError(404, 'Ticket not found');
  }

  const updates = { updatedBy: `Admin-${adminId}` };
  if (status) updates.status = status;
  if (admin_comments) updates.admin_comments = admin_comments;

  await ticket.update(updates);

  res.status(200).json({
    status: 'success',
    message: MSG_UPDATE_SUCCESSFUL,
    data: ticket
  });
};
