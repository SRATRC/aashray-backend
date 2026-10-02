import { randomBytes } from 'crypto';
import logger from '../config/logger.js';

export const httpLogger = (req, res, next) => {
  const start = Date.now();

  // Unique ID for this request — use X-Request-Id from client if provided (e.g. from mobile app)
  const correlationId =
    req.headers['x-request-id'] || randomBytes(6).toString('hex');
  req.correlationId = correlationId;

  // Expose it in the response so clients can correlate errors
  res.setHeader('X-Request-Id', correlationId);

  // Create a child logger with this request's context baked in.
  // Any code that does req.log.info(...) will automatically include these fields.
  req.log = logger.child({
    correlationId,
    method: req.method,
    path: req.originalUrl
  });

  // Log the incoming request (sanitize sensitive fields)
  const sanitizedBody = sanitizeBody(req.body);
  const hasBody =
    sanitizedBody &&
    typeof sanitizedBody === 'object' &&
    Object.keys(sanitizedBody).length > 0;
  req.log.info('request_received', {
    ...(hasBody && { body: JSON.stringify(sanitizedBody) }),
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });

  // Intercept res.send to log the response body (truncated if large)
  const originalSend = res.send;
  let logged = false;
  res.send = function (body) {
    if (!logged) {
      logged = true;
      const duration = Date.now() - start;
      const logFn =
        res.statusCode >= 500
          ? 'error'
          : res.statusCode >= 400
            ? 'warn'
            : 'info';

      req.log[logFn]('request_completed', {
        statusCode: res.statusCode,
        durationMs: duration,
        // Only log response body for errors to avoid bloat
        ...(res.statusCode >= 400 && {
          responseBody: truncate(
            typeof body === 'string' ? body : JSON.stringify(body)
          )
        })
      });
    }
    return originalSend.call(this, body);
  };

  next();
};

// Attach userId to req.log after auth middleware has run.
// Call this in any auth middleware after setting req.user.
export const attachUserContext = (req) => {
  if (req.log && req.user) {
    const userId = req.user.cardno || req.user.id || req.user.username;
    req.log = req.log.child({ userId });
  }
};

// Strip fields you never want in logs (passwords, tokens, etc.)
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  const SENSITIVE = ['password', 'token', 'secret', 'otp', 'pin'];
  const safe = { ...body };
  for (const key of SENSITIVE) {
    if (key in safe) safe[key] = '[REDACTED]';
  }
  return safe;
}

function truncate(str, maxLen = 500) {
  if (!str) return str;
  return str.length > maxLen ? str.slice(0, maxLen) + '…[truncated]' : str;
}
