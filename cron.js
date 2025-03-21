import './config/environment.js';
import { cancelPendingBookings } from './helpers/transactions.helper.js';
import sequelize from './config/database.js';
import cron from 'node-cron';
import logger from './config/logger.js';

// Schedule the cron job to run every minute
// TODO: update to run every N minutes
const job = cron.schedule('* * * * *', async () => {
  logger.info('Cron job starting...');

  try {
    await sequelize.authenticate();

    await cancelPendingBookings();
  } catch (error) {
    logger.error('Cron job error:', error);
  }

  logger.info('Cron job finishing...');
});

job.start();
