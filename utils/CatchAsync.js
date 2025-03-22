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
