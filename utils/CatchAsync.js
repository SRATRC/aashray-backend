import logger from '../config/logger.js';

const catchAsync = (fn) => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(async (err) => {
    try {
      if (req.transaction) {
        await req.transaction.rollback();
        logger.warn(
          `Transaction rolled back for ${req.method} ${req.originalUrl}`
        );
      }
    } catch (rollbackError) {
      logger.error(`Error rolling back transaction: ${rollbackError.message}`);
    }
    next(err);
  });
};

export default catchAsync;

// MySQL deadlock (1213) and lock-wait timeout (1205), whether Sequelize wraps the
// driver error (err.parent / err.original) or not.
export const isRetryableDbError = (err) => {
  for (let e = err, i = 0; e && i < 4; e = e.parent || e.original, i++) {
    if (e.errno === 1213 || e.errno === 1205) return true;
    if (e.code === 'ER_LOCK_DEADLOCK' || e.code === 'ER_LOCK_WAIT_TIMEOUT') return true;
  }
  return false;
};

/**
 * catchAsync + bounded whole-request retry on MySQL deadlock / lock-wait timeout.
 *
 * MySQL rolls the losing transaction back, so the only correct recovery is to
 * run the handler again from the top. Rules for a handler wrapped with this:
 *   - it opens its own transaction (stored on req.transaction) and sends push /
 *     email / WhatsApp only AFTER t.commit();
 *   - external, non-transactional side effects (a Razorpay order) are kept on
 *     req.retryCache so a retry reuses them instead of creating a second one;
 *   - a response that was already sent is never retried.
 * req.body is restored before every attempt because handlers may mutate it.
 */
export const catchAsyncRetry = (fn, { attempts = 3, baseDelayMs = 40 } = {}) => {
  const wrapped = async (req, res, next) => {
    const originalBody = req.body === undefined ? undefined : structuredClone(req.body);
    req.retryCache = {};
    let lastErr;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let captured = null;
      // Some handlers catch their own errors and hand them to next(err).
      const capNext = (e) => { if (e !== undefined) captured = e; else next(); };
      try {
        req.transaction = undefined;
        if (originalBody !== undefined) req.body = structuredClone(originalBody);
        await fn(req, res, capNext);
      } catch (err) {
        captured = err;
      }
      if (!captured) return;
      lastErr = captured;
      try {
        if (req.transaction && !req.transaction.finished) await req.transaction.rollback();
      } catch (rollbackError) {
        logger.error(`Error rolling back transaction: ${rollbackError.message}`);
      }
      if (isRetryableDbError(captured) && attempt < attempts && !res.headersSent) {
        logger.warn(
          `DB deadlock/lock-timeout on ${req.method} ${req.originalUrl}; retry ${attempt}/${attempts - 1}`
        );
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt + Math.random() * baseDelayMs * 2));
        continue;
      }
      break;
    }
    return next(lastErr);
  };
  return wrapped;
};
