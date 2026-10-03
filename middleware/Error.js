import logger from '../config/logger.js';

export const ErrorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Something went wrong';
  const data = err.data || err.stack;

  // Use req.log (child logger) if available — it carries correlationId + userId automatically
  const log = req.log || logger;

  if (statusCode >= 500) {
    log.error('unhandled_error', {
      statusCode,
      message,
      stack: err.stack,
      ...(data && data !== err.stack && { data })
    });
  } else if (statusCode >= 400) {
    log.warn('client_error', {
      statusCode,
      message,
      ...(data && { data })
    });
  }

  return res.status(statusCode).json({
    statusCode,
    message,
    data
  });
};
