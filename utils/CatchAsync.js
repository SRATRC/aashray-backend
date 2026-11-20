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

// MySQL deadlock (1213), whether Sequelize wraps the driver error
// (err.parent / err.original) or not. Lock-wait timeout (1205) is deliberately
// NOT retried: each wait already burns innodb_lock_wait_timeout (50s), so a retry
// would run past the app's 120s booking timeout and the member would see a
// timeout for a request that may still complete.
export const isRetryableDbError = (err) => {
  for (let e = err, i = 0; e && i < 4; e = e.parent || e.original, i++) {
    if (e.errno === 1213 || e.code === 'ER_LOCK_DEADLOCK') return true;
  }
  return false;
};

// Never start another attempt once the request has run this long (well inside
// the app's 120s booking timeout).
const RETRY_BUDGET_MS = 60000;

/**
 * catchAsync + bounded whole-request retry on MySQL deadlock (1213).
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
    const startedAt = Date.now();
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
      // Was the transaction already committed? Then the work is durable and
      // running the handler again would duplicate it (and its side effects).
      const committed = req.transaction && req.transaction.finished === 'commit';
      try {
        if (req.transaction && !req.transaction.finished) await req.transaction.rollback();
      } catch (rollbackError) {
        logger.error(`Error rolling back transaction: ${rollbackError.message}`);
      }
      if (
        isRetryableDbError(captured) &&
        attempt < attempts &&
        !res.headersSent &&
        !committed &&
        Date.now() - startedAt < RETRY_BUDGET_MS
      ) {
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
