import ApiError from '../utils/ApiError.js';
import { TicketAttachment } from '../models/associations.js';
import {
  verifyObject,
  deleteObjects,
  buildAttachmentKey,
  createPresignedPutUrl
} from './ticketAttachment.helper.js';
import {
  MAX_IMAGES_PER_BATCH,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  MAX_VIDEOS_PER_TICKET
} from '../config/constants.js';

// Shared attachment orchestration used by both the client and admin ticket
// controllers. Kept in its own module (separate from ticketAttachment.helper.js
// which owns the raw S3 calls) so the S3 primitives it depends on — verifyObject
// / deleteObjects — can be mocked in tests while this validation + persistence
// logic runs for real.

const KINDS = ['image', 'video'];

// Validate a presign batch: shape, per-kind counts, content-type/kind match,
// per-file declared size, and (video) declared duration. `allowVideo` is false
// for admins (video is user-only in v1). Throws ApiError(400) with a specific
// reason; returns the normalized items on success.
export function validateAttachmentBatch(files, { allowVideo }) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ApiError(400, 'attachments must be a non-empty array');
  }

  let imageCount = 0;
  let videoCount = 0;
  const items = [];

  for (const f of files) {
    if (!f || typeof f !== 'object') {
      throw new ApiError(400, 'Invalid attachment entry');
    }
    const { filename, contentType, size, kind, durationSec } = f;

    if (!KINDS.includes(kind)) {
      throw new ApiError(400, 'Attachment kind must be image or video');
    }
    if (typeof contentType !== 'string') {
      throw new ApiError(400, 'Attachment contentType is required');
    }

    const prefix = kind === 'video' ? 'video/' : 'image/';
    if (!contentType.startsWith(prefix)) {
      throw new ApiError(400, 'Attachment contentType does not match its kind');
    }

    if (kind === 'video' && !allowVideo) {
      throw new ApiError(400, 'Video attachments are not allowed');
    }

    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
      throw new ApiError(400, 'Attachment size must be a positive number');
    }
    const maxBytes = kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (size > maxBytes) {
      throw new ApiError(400, `Attachment exceeds the ${kind} size limit`);
    }

    if (kind === 'video') {
      if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec <= 0) {
        throw new ApiError(400, 'Video durationSec is required');
      }
      if (durationSec > MAX_VIDEO_SECONDS) {
        throw new ApiError(400, `Video exceeds the ${MAX_VIDEO_SECONDS}s duration limit`);
      }
      videoCount += 1;
    } else {
      imageCount += 1;
    }

    items.push({ filename, contentType, size, kind, durationSec });
  }

  if (imageCount > MAX_IMAGES_PER_BATCH) {
    throw new ApiError(400, `At most ${MAX_IMAGES_PER_BATCH} images per batch`);
  }
  if (videoCount > MAX_VIDEOS_PER_TICKET) {
    throw new ApiError(400, `At most ${MAX_VIDEOS_PER_TICKET} videos per batch`);
  }

  return items;
}

// Normalize the `attachments` array a create/message request references. Each
// entry must be { key, contentType, kind }. Non-arrays become []. Throws on a
// malformed entry.
export function normalizeAttachmentRefs(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new ApiError(400, 'attachments must be an array');
  }
  return input.map((a) => {
    if (!a || typeof a !== 'object' || typeof a.key !== 'string' || typeof a.contentType !== 'string') {
      throw new ApiError(400, 'Invalid attachment reference');
    }
    if (!KINDS.includes(a.kind)) {
      throw new ApiError(400, 'Attachment kind must be image or video');
    }
    return { key: a.key, contentType: a.contentType, kind: a.kind };
  });
}

// Authoritatively verify every referenced key via HeadObject before we persist
// anything. `allowVideo` is false for admins. On the first failure the whole
// batch's S3 objects are best-effort deleted and a 400 is thrown (so partial
// uploads don't leak). Returns the verified rows (with real size/content-type
// from storage) ready to persist.
export async function verifyAttachmentsOrThrow(refs, { allowVideo }) {
  if (refs.length === 0) return [];

  for (const a of refs) {
    if (a.kind === 'video' && !allowVideo) {
      throw new ApiError(400, 'Video attachments are not allowed');
    }
    const prefix = a.kind === 'video' ? 'video/' : 'image/';
    if (!a.contentType.startsWith(prefix)) {
      throw new ApiError(400, 'Attachment contentType does not match its kind');
    }
  }

  // HeadObject-verify every key concurrently. Fail fast: on any failure (a
  // returned !ok, or a rejection) best-effort delete the whole batch's keys so
  // partial uploads don't leak, then 400. `results` preserves batch order, so
  // findIndex reports the first-in-order failure's reason (as the old
  // sequential loop did).
  const keys = refs.map((x) => x.key);
  let results;
  try {
    results = await Promise.all(
      refs.map((a) => verifyObject({ key: a.key, kind: a.kind, contentType: a.contentType }))
    );
  } catch (err) {
    await deleteObjects(keys).catch(() => {});
    throw new ApiError(400, `Attachment verification failed: ${err.message}`);
  }

  const failedIndex = results.findIndex((r) => !r.ok);
  if (failedIndex !== -1) {
    await deleteObjects(keys).catch(() => {});
    throw new ApiError(400, `Attachment verification failed: ${results[failedIndex].reason}`);
  }

  return refs.map((a, i) => ({
    key: a.key,
    kind: a.kind,
    contentType: results[i].contentType,
    size: results[i].size
  }));
}

// Count the user-uploaded, non-expired videos already on a ticket — the base
// for the per-ticket video cap. Runs inside the request transaction so a
// concurrent attach can't slip past the cap.
export async function countExistingUserVideos(ticketId, transaction) {
  return TicketAttachment.count({
    where: { ticket_id: ticketId, kind: 'video', expired_at: null },
    transaction
  });
}

// Persist verified attachment rows in the caller's transaction. message_id is
// null for ticket-level (creation-time) media.
export async function persistAttachments(verified, { ticketId, messageId, uploadedBy }, transaction) {
  if (verified.length === 0) return [];
  const now = new Date();
  return TicketAttachment.bulkCreate(
    verified.map((a) => ({
      ticket_id: ticketId,
      message_id: messageId ?? null,
      s3_key: a.key,
      content_type: a.contentType,
      kind: a.kind,
      size: a.size,
      uploaded_by: uploadedBy,
      uploaded_at: now
    })),
    { transaction }
  );
}

// Serialize a stored attachment row for a getTicketDetails response. The serve
// URL is minted per request behind an auth check (rather than embedding a raw
// presigned URL that could be shared/leaked), so `buildServeUrl(ticketId,
// attachmentId) => path` is supplied by each controller — the client and admin
// serve endpoints differ only in their path prefix.
export function attachmentDto(attachment, buildServeUrl) {
  return {
    id: attachment.id,
    kind: attachment.kind,
    contentType: attachment.content_type,
    url: buildServeUrl(attachment.ticket_id, attachment.id),
    expired: !!attachment.expired_at
  };
}

// Split a ticket's attachments into ticket-level (message_id null — filed at
// creation) vs a per-message Map, mapping each row through `dtoFn`. Returns
// { ticketLevel, byMessageId }.
export function groupAttachmentsByMessage(attachments, dtoFn) {
  const byMessageId = new Map();
  const ticketLevel = [];
  for (const a of attachments) {
    const dto = dtoFn(a);
    if (a.message_id === null || a.message_id === undefined) {
      ticketLevel.push(dto);
    } else {
      const list = byMessageId.get(a.message_id) || [];
      list.push(dto);
      byMessageId.set(a.message_id, list);
    }
  }
  return { ticketLevel, byMessageId };
}

// Validate a presign batch, then mint one presigned PUT URL per file. `owner`
// scopes the pending upload key (cardno for a user, username for an admin);
// `allowVideo` is false for admins. Returns [{ key, uploadUrl }] in batch order
// (per-file key build + presign run concurrently). Throws ApiError(400) on an
// invalid batch.
export async function presignBatch(files, { owner, allowVideo }) {
  const items = validateAttachmentBatch(files, { allowVideo });
  return Promise.all(
    items.map(async (f) => {
      const key = buildAttachmentKey({ owner, contentType: f.contentType, filename: f.filename });
      const uploadUrl = await createPresignedPutUrl({ key, contentType: f.contentType });
      return { key, uploadUrl };
    })
  );
}

// Resolve a stored attachment for the serve endpoint: find the row within the
// ticket, 404 if missing, 410 if tombstoned (expired_at set). The caller does
// its own ticket authorization first, then redirects to a fresh presigned GET
// URL for the returned row's key.
export async function resolveAttachmentForServe(ticketId, attachmentId) {
  const attachment = await TicketAttachment.findOne({
    where: { id: attachmentId, ticket_id: ticketId }
  });
  if (!attachment) {
    throw new ApiError(404, 'Attachment not found');
  }
  if (attachment.expired_at) {
    throw new ApiError(410, 'This attachment was removed after the retention period');
  }
  return attachment;
}
