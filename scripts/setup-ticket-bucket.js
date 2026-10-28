/**
 * One-time, idempotent setup for the private ticket-media S3 bucket.
 *
 * Run ONCE PER ENVIRONMENT before deploying the media-attachments feature:
 *
 *   NODE_ENV=prod node scripts/setup-ticket-bucket.js
 *
 * It (idempotently):
 *   1. Creates the bucket (AWS_S3_TICKET_BUCKET) if it doesn't exist, with
 *      Block Public Access fully ON (the bucket is private — objects are only
 *      ever reached via short-lived presigned URLs).
 *   2. Puts a CORS config allowing PUT (browser presigned upload) and GET
 *      (browser preview) from the admin origin(s). The mobile app is native
 *      and CORS-exempt.
 *   3. Puts a lifecycle rule expiring every object 67 days after creation
 *      (retention 60d + 7d grace) as a backstop to the cleanup cron.
 *
 * Required env (reuses the existing AWS_* credentials):
 *   AWS_REGION              e.g. ap-south-1
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   AWS_S3_TICKET_BUCKET    the (new) private bucket name
 *
 * Optional env:
 *   TICKET_CORS_ORIGINS     comma-separated allowed origins for CORS
 *                           (default: "*"). Set to your admin dashboard
 *                           origin(s) in production, e.g.
 *                           "https://admin.example.com".
 *
 * IAM: the principal needs s3:CreateBucket + s3:PutBucketPublicAccessBlock +
 * s3:PutBucketCors + s3:PutLifecycleConfiguration on the bucket (setup), and at
 * runtime s3:PutObject/GetObject/DeleteObject/HeadObject on
 * arn:aws:s3:::<bucket>/* plus s3:ListBucket on the bucket.
 */

import '../config/environment.js';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand
} from '@aws-sdk/client-s3';
import { ATTACHMENT_RETENTION_DAYS } from '../config/constants.js';

const RETENTION_GRACE_DAYS = 7;
const LIFECYCLE_EXPIRATION_DAYS = ATTACHMENT_RETENTION_DAYS + RETENTION_GRACE_DAYS; // 67

async function main() {
  const region = process.env.AWS_REGION;
  const bucket = process.env.AWS_S3_TICKET_BUCKET;

  if (!region) throw new Error('AWS_REGION is not set');
  if (!bucket) throw new Error('AWS_S3_TICKET_BUCKET is not set');
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not set');
  }

  const corsOrigins = (process.env.TICKET_CORS_ORIGINS || '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const s3Config = {
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  };
  // Optional S3-compatible endpoint override for local dev / tests (LocalStack,
  // MinIO). Unset in production. Path-style is required by those emulators.
  if (process.env.AWS_S3_ENDPOINT) {
    s3Config.endpoint = process.env.AWS_S3_ENDPOINT;
    s3Config.forcePathStyle = true;
  }
  const s3 = new S3Client(s3Config);

  // 1. Create the bucket if missing (idempotent).
  let exists = false;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    exists = true;
    console.log(`[ok] Bucket "${bucket}" already exists — skipping create.`);
  } catch (err) {
    // 404/NotFound => create it. Anything else (403, etc.) is a real error.
    const status = err?.$metadata?.httpStatusCode;
    if (status && status !== 404 && err.name !== 'NotFound' && err.name !== 'NoSuchBucket') {
      throw err;
    }
  }

  if (!exists) {
    try {
      await s3.send(
        new CreateBucketCommand({
          Bucket: bucket,
          // us-east-1 must NOT send a LocationConstraint; every other region must.
          ...(region === 'us-east-1'
            ? {}
            : { CreateBucketConfiguration: { LocationConstraint: region } })
        })
      );
      console.log(`[ok] Created bucket "${bucket}".`);
    } catch (err) {
      if (err.name === 'BucketAlreadyOwnedByYou' || err.name === 'BucketAlreadyExists') {
        console.log(`[ok] Bucket "${bucket}" already owned — continuing.`);
      } else {
        throw err;
      }
    }
  }

  // 2. Block Public Access — the bucket must never be world-readable.
  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: bucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true
      }
    })
  );
  console.log('[ok] Block Public Access enabled.');

  // 3. CORS for browser presigned PUT/GET (admin dashboard).
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedMethods: ['PUT', 'GET'],
            AllowedOrigins: corsOrigins,
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3000
          }
        ]
      }
    })
  );
  console.log(`[ok] CORS set (PUT/GET) for origins: ${corsOrigins.join(', ')}.`);

  // 4. Lifecycle rule — backstop expiration for every object.
  await s3.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: 'ticket-media-retention',
            Status: 'Enabled',
            Filter: { Prefix: '' },
            Expiration: { Days: LIFECYCLE_EXPIRATION_DAYS }
          }
        ]
      }
    })
  );
  console.log(`[ok] Lifecycle rule set (expire objects after ${LIFECYCLE_EXPIRATION_DAYS} days).`);

  console.log(`\nDone. Ticket bucket "${bucket}" is ready.`);
}

main().catch((err) => {
  console.error('setup-ticket-bucket failed:', err.message || err);
  process.exit(1);
});
