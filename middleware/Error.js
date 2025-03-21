import logger from '../config/logger.js';

export const ErrorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Something went wrong';
  const data = err.data || err.stack;

  // Log the error with Winston
  const logMessage = `${req.method} ${req.originalUrl} - ${statusCode} - ${message}`;

  if (statusCode >= 500) {
    logger.error(logMessage);
    if (data) logger.error(data);
  } else if (statusCode >= 400) {
    logger.warn(logMessage);
    if (data) logger.warn(data);
  }

  return res.status(statusCode).json({
    statusCode,
    message,
    data
  });
};
