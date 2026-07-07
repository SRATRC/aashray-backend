import { Ticket, TicketMessage, TicketAttachment } from '../../models/associations.js';
import ApiError from '../../utils/ApiError.js';
import {
  MSG_UPDATE_SUCCESSFUL,
  MSG_FETCH_SUCCESSFUL,
  STATUS_CLOSED,
  STATUS_INPROGRESS,
  STATUS_RESOLVED,
  TICKET_SERVICE_ROLE_MAP,
  MAX_VIDEOS_PER_TICKET
} from '../../config/constants.js';
import crypto from 'crypto';
import database from '../../config/database.js';
import ticketStreamManager from '../../utils/ticketStreamManager.js';
import { attachUserContext } from '../../middleware/Logger.js';
import { createPresignedGetUrl } from '../../helpers/ticketAttachment.helper.js';
import {
  normalizeAttachmentRefs,
  verifyAttachmentsOrThrow,
  persistAttachments,
  countExistingUserVideos,
  attachmentDto,
  groupAttachmentsByMessage,
  presignBatch,
  resolveAttachmentForServe
} from '../../helpers/ticketAttachmentOrchestrator.js';

const MAX_METADATA_LENGTH = 16000;
const MAX_ID_RETRIES = 5;
// Mirror of the `os` ENUM values on the Ticket model. Validated here so an
// out-of-range value returns a 400 instead of surfacing Sequelize's
// SequelizeValidationError (which has no statusCode) as a 500.
const ALLOWED_OS = ['Android', 'iOS', 'Web', 'Other'];

// Base path of the client serve endpoint (see routes/client/ticket.routes.js).
// getTicketDetails returns each attachment's `url` pointing here rather than a
// raw presigned URL — the URL is minted per request behind an auth check so it
// can't be shared/leaked and expires ~5 min after issue.
const buildServeUrl = (ticketId, attachmentId) =>
  `/api/v1/tickets/${ticketId}/attachments/${attachmentId}`;

async function loadOwnedTicketOrThrow(ticket_id, cardno, options = {}) {
  const ticket = await Ticket.findOne({
    where: { id: ticket_id, issued_by: cardno },
    ...options
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

  const attachmentRefs = normalizeAttachmentRefs(req.body.attachments);

  // description becomes optional once at least one attachment is present — an
  // image/video can be the whole request.
  if (!service || (!description && attachmentRefs.length === 0)) {
    throw new ApiError(400, 'Service and description are required');
  }

  if (!Object.keys(TICKET_SERVICE_ROLE_MAP).includes(service)) {
    throw new ApiError(400, 'Invalid service');
  }

  if (os !== undefined && os !== null && !ALLOWED_OS.includes(os)) {
    throw new ApiError(400, 'Invalid os');
  }

  // Verify referenced S3 objects before opening the transaction. On failure
  // this 400s and best-effort deletes the orphaned uploads. A fresh ticket has
  // no existing videos, so the batch itself must be within the per-ticket cap.
  const verifiedAttachments = await verifyAttachmentsOrThrow(attachmentRefs, {
    allowVideo: true
  });
  const newVideoCount = verifiedAttachments.filter((a) => a.kind === 'video').length;
  if (newVideoCount > MAX_VIDEOS_PER_TICKET) {
    throw new ApiError(400, `At most ${MAX_VIDEOS_PER_TICKET} videos per ticket`);
  }

  let { metadata } = req.body;
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))
    metadata = {};
  // Byte-accurate size check (the JSON column is measured in bytes, and
  // String#length would undercount multi-byte characters). If oversized,
  // keep a truncated string preview rather than discarding the whole blob —
  // an over-large diagnostics blob still has debugging value; an empty one
  // doesn't, which defeats the point of capturing it.
  const serializedMetadata = JSON.stringify(metadata);
  if (Buffer.byteLength(serializedMetadata) > MAX_METADATA_LENGTH) {
    metadata = { truncated: true, preview: serializedMetadata.slice(0, MAX_METADATA_LENGTH) };
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
          description: description || '',
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

  await persistAttachments(
    verifiedAttachments,
    { ticketId: ticket.id, messageId: null, uploadedBy: cardno },
    t
  );

  await t.commit();
  req.transaction = null;

  req.log.info('create_ticket_success', {
    cardno,
    ticketId: ticket.id,
    attachments: verifiedAttachments.length
  });

  res.status(201).send({
    message: 'Successfully created ticket',
    data: ticket
  });
};

export const getTickets = async (req, res) => {
  const { cardno } = req.user;
  // Clamp so a malformed ?page=-1 can't produce a negative OFFSET (SQL error)
  // and ?page_size can't request an unbounded result set.
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size) || 10));
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

  const ticket = await loadOwnedTicketOrThrow(ticket_id, cardno, {
    include: [
      {
        model: TicketMessage,
        as: 'messages',
        separate: true,
        order: [['createdAt', 'ASC']]
      }
    ]
  });

  const attachments = await TicketAttachment.findAll({
    where: { ticket_id },
    order: [['createdAt', 'ASC']]
  });

  const { ticketLevel, byMessageId } = groupAttachmentsByMessage(attachments, (a) =>
    attachmentDto(a, buildServeUrl)
  );

  const data = ticket.toJSON();
  data.attachments = ticketLevel;
  data.messages = (data.messages || []).map((m) => ({
    ...m,
    attachments: byMessageId.get(m.id) || []
  }));

  res.status(200).send({
    message: MSG_FETCH_SUCCESSFUL,
    data
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
  // Disable proxy buffering (nginx / Render) so SSE frames flush immediately
  // instead of being held back until a buffer fills.
  res.setHeader('X-Accel-Buffering', 'no');
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

  const attachmentRefs = normalizeAttachmentRefs(req.body.attachments);

  // message text becomes optional once at least one attachment is present.
  if (!message && attachmentRefs.length === 0) {
    throw new ApiError(400, 'Message is required');
  }

  const ticket = await loadOwnedTicketOrThrow(ticket_id, cardno);

  if (ticket.status === STATUS_CLOSED) {
    throw new ApiError(400, 'Cannot reply to a closed ticket');
  }

  // Verify referenced S3 objects (best-effort cleanup + 400 on failure) before
  // opening the transaction.
  const verifiedAttachments = await verifyAttachmentsOrThrow(attachmentRefs, {
    allowVideo: true
  });

  req.log.info('ticket_add_message_start', { cardno, ticketId: ticket_id });

  const t = await database.transaction();
  req.transaction = t;

  // Per-ticket video cap: existing user videos + new videos in this batch
  // must not exceed MAX_VIDEOS_PER_TICKET. Counted inside the transaction.
  const newVideoCount = verifiedAttachments.filter((a) => a.kind === 'video').length;
  if (newVideoCount > 0) {
    const existingVideos = await countExistingUserVideos(ticket_id, t);
    if (existingVideos + newVideoCount > MAX_VIDEOS_PER_TICKET) {
      throw new ApiError(400, `At most ${MAX_VIDEOS_PER_TICKET} videos per ticket`);
    }
  }

  const newMessage = await TicketMessage.create(
    {
      ticket_id,
      sender_id: cardno,
      sender_type: 'user',
      message: message || ''
    },
    { transaction: t }
  );

  await persistAttachments(
    verifiedAttachments,
    { ticketId: ticket_id, messageId: newMessage.id, uploadedBy: cardno },
    t
  );

  // If ticket was resolved, move back to in progress since user is replying.
  const updates = { updatedBy: cardno };
  if (ticket.status === STATUS_RESOLVED) {
    updates.status = STATUS_INPROGRESS;
  }

  await ticket.recordActivity(updates, { transaction: t });

  await t.commit();
  req.transaction = null;

  // Flag attachments on the frame (not the DTOs themselves — the serve URL is
  // audience-specific, client vs admin). Subscribers refetch the ticket to
  // backfill the attachments with their own correct URLs when this is set.
  ticketStreamManager.broadcastMessage(ticket_id, {
    ...newMessage.toJSON(),
    hasAttachments: verifiedAttachments.length > 0
  });
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

  await ticket.recordActivity(
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

// POST /attachments/presign
// Body: { files: [{ filename, contentType, size, kind, durationSec? }] }
// (a bare array is also accepted). Validates the batch, then returns one
// { key, uploadUrl } per file — presigned PUT URLs the client uploads to
// directly. cardno comes from body/query via validateCard.
export const presignAttachments = async (req, res) => {
  const { cardno } = req.user;
  attachUserContext(req);

  const files = Array.isArray(req.body) ? req.body : req.body.files;
  const data = await presignBatch(files, { owner: cardno, allowVideo: true });

  req.log.info('ticket_presign_start', { cardno, count: data.length });

  res.status(200).send({
    message: MSG_FETCH_SUCCESSFUL,
    data
  });
};

// GET /:ticket_id/attachments/:attachmentId
// Authorizes (ticket owner), then 302-redirects to a fresh presigned GET URL,
// or 410 if the object has been cleaned up (expired_at set).
export const serveAttachment = async (req, res) => {
  const { ticket_id, attachmentId } = req.params;
  const { cardno } = req.user;

  await loadOwnedTicketOrThrow(ticket_id, cardno);

  const attachment = await resolveAttachmentForServe(ticket_id, attachmentId);

  return res.redirect(302, await createPresignedGetUrl({ key: attachment.s3_key }));
};

const generateTicketId = () => {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
};
