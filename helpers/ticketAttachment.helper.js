import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from '../config/constants.js';

// Ticket media lives in a dedicated PRIVATE bucket (AWS_S3_TICKET_BUCKET),
// separate from the public profile-picture bucket: support screenshots/videos
// can contain personal data and must never be world-readable, and the bucket
// gets its own retention lifecycle rule + CORS. Region/creds are reused from
// the existing AWS_* env vars.

// Every object key lives under this prefix — the serve/verify paths reject
// anything outside it so a forged key can't point the presigner at an
// arbitrary object elsewhere in the bucket.
export const TICKET_KEY_PREFIX = 'tickets/';

const PUT_URL_EXPIRY_SECONDS = 5 * 60; // short-lived upload URL
const GET_URL_EXPIRY_SECONDS = 5 * 60; // short-lived download URL (per serve request)
const DELETE_CHUNK_SIZE = 1000; // S3 DeleteObjects hard limit per request

// Common content-type -> extension map; falls back to the filename extension
// and finally 'bin'. Extension is cosmetic (the object is served with its
// stored ContentType), so an imperfect guess is harmless.
const EXT_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/3gpp': '3gp'
};

let _client;
// Lazily constructed so importing this module (e.g. via jest.requireActual in
// tests, or on a box without the ticket bucket configured) never touches the
// network or requires the env to be present until an S3 call is actually made.
export function getTicketS3Client() {
  if (!_client) {
    const config = {
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      },
      // @aws-sdk/client-s3 >= 3.729 bakes a default CRC32 checksum into
      // presigned PUT URLs (x-amz-checksum-crc32 + x-amz-sdk-checksum-algorithm
      // in the signed query). Our clients upload with a plain fetch PUT and
      // don't send that checksum header, so S3 rejects the upload with 400.
      // WHEN_REQUIRED stops the SDK from adding the checksum unless explicitly
      // requested, keeping presigned PUTs uploadable by a bare PUT.
      requestChecksumCalculation: 'WHEN_REQUIRED'
    };
    // Optional S3-compatible endpoint override for local dev / tests
    // (LocalStack, MinIO). Only active when AWS_S3_ENDPOINT is set — production
    // leaves it unset and talks to real AWS. Path-style addressing is required
    // by those emulators (they don't do virtual-hosted bucket subdomains).
    if (process.env.AWS_S3_ENDPOINT) {
      config.endpoint = process.env.AWS_S3_ENDPOINT;
      config.forcePathStyle = true;
    }
    _client = new S3Client(config);
  }
  return _client;
}

function getBucket() {
  const bucket = process.env.AWS_S3_TICKET_BUCKET;
  if (!bucket) {
    throw new Error('AWS_S3_TICKET_BUCKET is not configured');
  }
  return bucket;
}

function extFor(contentType, filename) {
  if (contentType && EXT_BY_CONTENT_TYPE[contentType.toLowerCase()]) {
    return EXT_BY_CONTENT_TYPE[contentType.toLowerCase()];
  }
  if (typeof filename === 'string' && filename.includes('.')) {
    const ext = filename.split('.').pop().toLowerCase();
    if (/^[a-z0-9]{1,5}$/.test(ext)) return ext;
  }
  return 'bin';
}

// key layout: tickets/<ticketId | pending/<owner>>/<uuid>.<ext>
// At creation time the ticket id doesn't exist yet, so uploads use a
// pending/<owner> scope; the final key is recorded as-is on attach (objects
// are never moved). `owner` is the uploader (cardno for a user, username for
// an admin) — it only scopes the pending path, verification only checks the
// tickets/ prefix.
export function buildAttachmentKey({ ticketId, owner, contentType, filename }) {
  const scope = ticketId ? String(ticketId) : `pending/${owner}`;
  return `${TICKET_KEY_PREFIX}${scope}/${uuidv4()}.${extFor(contentType, filename)}`;
}

export function isTicketKey(key) {
  return (
    typeof key === 'string' &&
    key.startsWith(TICKET_KEY_PREFIX) &&
    !key.includes('..')
  );
}

// Presigned PUT with the content-type bound into the signature, so the client
// can only upload an object of exactly the declared type to exactly this key.
export async function createPresignedPutUrl({ key, contentType, expiresIn = PUT_URL_EXPIRY_SECONDS }) {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType
  });
  return getSignedUrl(getTicketS3Client(), command, { expiresIn });
}

export async function createPresignedGetUrl({ key, expiresIn = GET_URL_EXPIRY_SECONDS }) {
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key
  });
  return getSignedUrl(getTicketS3Client(), command, { expiresIn });
}

// Authoritative gate before persisting a referenced key: the object must exist,
// sit under the tickets/ prefix, carry a content-type matching its declared
// kind, and be within the size limit for that kind. Returns { ok, reason } so
// the caller can 400 with a specific reason and clean up the batch.
export async function verifyObject({ key, kind, contentType }) {
  if (!isTicketKey(key)) {
    return { ok: false, reason: 'key is not under the tickets/ prefix' };
  }
  let head;
  try {
    head = await getTicketS3Client().send(
      new HeadObjectCommand({ Bucket: getBucket(), Key: key })
    );
  } catch (err) {
    return { ok: false, reason: 'object not found in storage' };
  }

  const size = head.ContentLength;
  const max = kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (typeof size !== 'number' || size <= 0) {
    return { ok: false, reason: 'object has no content' };
  }
  if (size > max) {
    return { ok: false, reason: 'object exceeds the size limit for its kind' };
  }

  const actualType = head.ContentType || contentType;
  const prefix = kind === 'video' ? 'video/' : 'image/';
  if (!actualType || !actualType.startsWith(prefix)) {
    return { ok: false, reason: 'object content-type does not match its kind' };
  }

  return { ok: true, size, contentType: actualType };
}

// Best-effort batch delete, chunked to S3's 1000-keys-per-request limit.
// Never throws — returns { deleted, errors } so callers (attach cleanup, the
// retention cron) can log and continue.
export async function deleteObjects(keys) {
  const unique = [...new Set((keys || []).filter(Boolean))];
  if (unique.length === 0) return { deleted: 0, errors: [] };

  let deleted = 0;
  const errors = [];
  for (let i = 0; i < unique.length; i += DELETE_CHUNK_SIZE) {
    const chunk = unique.slice(i, i + DELETE_CHUNK_SIZE);
    try {
      const res = await getTicketS3Client().send(
        new DeleteObjectsCommand({
          Bucket: getBucket(),
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true }
        })
      );
      const chunkErrors = res.Errors || [];
      deleted += chunk.length - chunkErrors.length;
      if (chunkErrors.length) errors.push(...chunkErrors);
    } catch (err) {
      errors.push({ Key: chunk.join(','), Message: err.message });
    }
  }
  return { deleted, errors };
}
