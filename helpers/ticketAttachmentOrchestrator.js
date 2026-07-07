import ApiError from '../utils/ApiError.js';
import { TicketAttachment } from '../models/associations.js';
import { verifyObject, deleteObjects } from './ticketAttachment.helper.js';
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

  const verified = [];
  for (const a of refs) {
    const result = await verifyObject({ key: a.key, kind: a.kind, contentType: a.contentType });
    if (!result.ok) {
      await deleteObjects(refs.map((x) => x.key)).catch(() => {});
      throw new ApiError(400, `Attachment verification failed: ${result.reason}`);
    }
    verified.push({
      key: a.key,
      kind: a.kind,
      contentType: result.contentType,
      size: result.size
    });
  }
  return verified;
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
