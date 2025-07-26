import database from '../config/database.js';
import logger from '../config/logger.js';

/**
 * Execute a query with timeout to prevent connection hanging
 * @param {string} query - SQL query string
 * @param {Object} options - Query options including replacements, type, etc.
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns {Promise} Query result
 */
export const queryWithTimeout = async (query, options = {}, timeoutMs = 30000) => {
  const queryPromise = database.query(query, options);
  
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Query timeout after ${timeoutMs}ms: ${query.substring(0, 100)}...`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([queryPromise, timeoutPromise]);
    return result;
  } catch (error) {
    logger.error(`Query failed or timed out: ${error.message}`);
    throw error;
  }
};

/**
 * Execute a transaction with timeout
 * @param {Function} transactionFn - Function that receives transaction object
 * @param {number} timeoutMs - Timeout in milliseconds (default: 60000)
 * @returns {Promise} Transaction result
 */
export const transactionWithTimeout = async (transactionFn, timeoutMs = 60000) => {
  let transaction;
  
  try {
    transaction = await database.transaction();
    
    const transactionPromise = transactionFn(transaction);
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Transaction timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const result = await Promise.race([transactionPromise, timeoutPromise]);
    await transaction.commit();
    return result;
    
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
        logger.warn('Transaction rolled back due to error or timeout');
      } catch (rollbackError) {
        logger.error(`Failed to rollback transaction: ${rollbackError.message}`);
      }
    }
    throw error;
  }
};

export default { queryWithTimeout, transactionWithTimeout };
