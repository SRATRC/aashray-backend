import logger from '../config/logger.js';

export const httpLogger = (req, res, next) => {
  const start = Date.now();

  // Log request body
  const requestBody = req.body ? JSON.stringify(req.body) : 'No request body';
  logger.info(
    `Request: ${req.method} ${req.originalUrl} - Body: ${requestBody}`
  );

  // Store original response methods
  const originalSend = res.send;

  // Override res.send
  res.send = function (body) {
    const responseBody = typeof body === 'string' ? body : JSON.stringify(body);
    logger.info(
      `Response: ${req.method} ${req.originalUrl} - Body: ${responseBody}`
    );
    return originalSend.call(this, body);
  };

  res.on('finish', () => {
    const duration = Date.now() - start;
    const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;

    if (res.statusCode >= 500) {
      logger.error(message);
    } else if (res.statusCode >= 400) {
      logger.warn(message);
    } else {
      logger.info(message);
    }
  });

  next();
};
