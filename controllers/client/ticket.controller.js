import { Ticket, TicketMessage } from '../../models/associations.js';
import ApiError from '../../utils/ApiError.js';
import {
  MSG_UPDATE_SUCCESSFUL,
  MSG_FETCH_SUCCESSFUL,
  STATUS_CLOSED,
  STATUS_INPROGRESS,
  STATUS_RESOLVED,
  TICKET_SERVICE_ROLE_MAP
} from '../../config/constants.js';
import crypto from 'crypto';
import database from '../../config/database.js';
import ticketStreamManager from '../../utils/ticketStreamManager.js';
import { attachUserContext } from '../../middleware/Logger.js';

const MAX_METADATA_LENGTH = 16000;
const MAX_ID_RETRIES = 5;

async function loadOwnedTicketOrThrow(ticket_id, cardno) {
  const ticket = await Ticket.findOne({
    where: { id: ticket_id, issued_by: cardno }
  });
  if (!ticket) {
    throw new ApiError(404, 'Ticket not found');
  }
  return ticket;
}

export const createTicket = async (req, res) => {
  const { service, description, os, app_version } = req.body;
  const { cardno } = req.user;
  attachUserContext(req);

  if (!service || !description) {
    throw new ApiError(400, 'Service and description are required');
  }

  if (!Object.keys(TICKET_SERVICE_ROLE_MAP).includes(service)) {
    throw new ApiError(400, 'Invalid service');
  }

  let { metadata } = req.body;
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))
    metadata = {};
  if (JSON.stringify(metadata).length > MAX_METADATA_LENGTH) {
    metadata = { truncated: true };
  }

  req.log.info('create_ticket_start', { cardno, service });

  const t = await database.transaction();
  req.transaction = t;

  let ticket;
  for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
    try {
      ticket = await Ticket.create(
        {
          id: generateTicketId(),
          issued_by: cardno,
          service,
          description,
          os,
          app_version,
          metadata
        },
        { transaction: t }
      );
      break;
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError' && attempt < MAX_ID_RETRIES - 1) {
        continue;
      }
      throw error;
    }
  }

  await t.commit();
  req.transaction = null;

  req.log.info('create_ticket_success', { cardno, ticketId: ticket.id });

  res.status(201).send({
    message: 'Successfully created ticket',
    data: ticket
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
        separate: true,
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

  await loadOwnedTicketOrThrow(ticket_id, cardno);

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
  attachUserContext(req);

  if (!message) {
    throw new ApiError(400, 'Message is required');
  }

  const ticket = await loadOwnedTicketOrThrow(ticket_id, cardno);

  if (ticket.status === STATUS_CLOSED) {
    throw new ApiError(400, 'Cannot reply to a closed ticket');
  }

  req.log.info('ticket_add_message_start', { cardno, ticketId: ticket_id });

  const t = await database.transaction();
  req.transaction = t;

  const newMessage = await TicketMessage.create(
    {
      ticket_id,
      sender_id: cardno,
      sender_type: 'user',
      message
    },
    { transaction: t }
  );

  // If ticket was resolved, move back to in progress since user is replying.
  const updates = { updatedBy: cardno };
  if (ticket.status === STATUS_RESOLVED) {
    updates.status = STATUS_INPROGRESS;
  }

  // Force `updatedBy` to be considered dirty even if its value happens to
  // already match (e.g. the same user replying twice with no status change):
  // Sequelize's update()/save() silently skip the entire UPDATE — including
  // the automatic updatedAt bump — when nothing in the given values actually
  // differs from the current row. Verified against this Sequelize version's
  // source (lib/model.js: save() computes options.fields from this.changed()
  // and returns early when it's empty) and empirically against a real DB.
  // Without this, the auto-close cron's "reset the clock on activity" guarantee
  // silently fails to hold.
  ticket.changed('updatedBy', true);
  await ticket.update(updates, { transaction: t });

  await t.commit();
  req.transaction = null;

  ticketStreamManager.broadcastMessage(ticket_id, newMessage);
  if (updates.status) {
    ticketStreamManager.broadcastStatusUpdate(ticket_id, updates.status, cardno);
  }

  req.log.info('ticket_add_message_success', { cardno, ticketId: ticket_id });

  res.status(201).send({
    message: MSG_UPDATE_SUCCESSFUL,
    data: newMessage
  });
};

export const resolveTicket = async (req, res) => {
  const { ticket_id } = req.params;
  const { cardno } = req.user;
  attachUserContext(req);

  const ticket = await loadOwnedTicketOrThrow(ticket_id, cardno);

  if (ticket.status === STATUS_CLOSED) {
    throw new ApiError(400, 'Ticket is already closed');
  }

  const t = await database.transaction();
  req.transaction = t;

  // status always genuinely changes here (the closed-already case already
  // threw above), so this update never hits the no-op-when-nothing-changed
  // path — no need to force `changed()` the way addMessage does.
  await ticket.update(
    {
      status: STATUS_CLOSED,
      updatedBy: cardno
    },
    { transaction: t }
  );

  await t.commit();
  req.transaction = null;

  ticketStreamManager.broadcastStatusUpdate(ticket_id, STATUS_CLOSED, cardno);

  req.log.info('ticket_resolve_success', { cardno, ticketId: ticket_id });

  res.status(200).send({
    message: MSG_UPDATE_SUCCESSFUL
  });
};

const generateTicketId = () => {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
};
