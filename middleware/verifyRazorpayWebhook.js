import crypto from 'crypto';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/CatchAsync.js';
import logger from '../config/logger.js';

const SIGNATURE_HEADER = 'x-razorpay-signature';

/**
 * Razorpay signs every webhook: HMAC-SHA256 of the exact request body, keyed on
 * the webhook secret from the dashboard, hex encoded in `x-razorpay-signature`.
 *
 * The SDK ships validateWebhookSignature, but it compares with `===`, which
 * returns as soon as two bytes differ. crypto.timingSafeEqual does not.
 */
const signatureMatches = (rawBody, signature, secret) => {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // timingSafeEqual throws on a length mismatch, and a wrong-length signature
  // is a mismatch anyway.
  if (expected.length !== signature.length) return false;

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
};

/**
 * Rejects any webhook that Razorpay did not sign.
 *
 * verifyPayment reads an order id, a status and an amount straight out of the
 * request body and settles transactions on the strength of them. Without this,
 * anyone holding an order id could post `status: captured` and confirm their
 * own bookings without paying. The amount reconciliation in verifyPayment caps
 * what such a request can claim; only the signature keeps it out.
 *
 * Runs before the controller, so a forged payload never reaches the database -
 * not even the razorpay_webhook audit row.
 */
export const verifyRazorpayWebhook = catchAsync(async (req, _res, next) => {
  // httpLogger sets req.log with this request's correlationId, so a rejection
  // ties back to the delivery that caused it. The fallback matches
  // middleware/Error.js, for the case where this runs before httpLogger has.
  const log = req.log || logger;
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.get(SIGNATURE_HEADER);

  // No secret means nothing can be verified. Reject rather than wave requests
  // through: a missing env var must not silently reopen the endpoint.
  if (!secret) {
    log.error('razorpay_webhook_secret_missing');
    throw new ApiError(401, 'Webhook signature verification unavailable');
  }

  // app.js keeps the raw bytes on req.rawBody, because the HMAC covers exactly
  // what Razorpay sent - re-serialising the parsed body would not reproduce it.
  if (!req.rawBody || !signature) {
    log.warn('razorpay_webhook_signature_absent', {
      hasBody: Boolean(req.rawBody),
      hasSignature: Boolean(signature)
    });
    throw new ApiError(401, 'Invalid webhook signature');
  }

  if (!signatureMatches(req.rawBody, signature, secret)) {
    log.error('razorpay_webhook_signature_invalid', { ip: req.ip });
    throw new ApiError(401, 'Invalid webhook signature');
  }

  next();
});
