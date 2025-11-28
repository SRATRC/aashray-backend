import Ticket from '../../models/ticket.model.js';
import TicketMessage from '../../models/ticket_message.model.js';
import ApiError from '../../utils/ApiError.js';
import {
  MSG_FETCH_SUCCESSFUL,
  MSG_UPDATE_SUCCESSFUL
} from '../../config/constants.js';
import crypto from 'crypto';

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

  const tickets = await Ticket.findAll({
    where: { issued_by: cardno },
    order: [['createdAt', 'DESC']]
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

  // const messages = await TicketMessage.findAll({
  //   where: { ticket_id },
  //   order: [['createdAt', 'ASC']]
  // });

  res.status(200).send({
    message: MSG_FETCH_SUCCESSFUL,
    // data: { ...ticket.toJSON(), messages }
    data: ticket
  });
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

  await TicketMessage.create({
    ticket_id,
    sender_id: cardno,
    sender_type: 'user',
    message
  });

  res.status(201).send({
    message: MSG_UPDATE_SUCCESSFUL
  });
};

const generateTicketId = () => {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
};
