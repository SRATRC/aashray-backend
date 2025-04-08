import './config/environment.js';
import moment from 'moment';
import { getPendingTransactions } from './helpers/transactions.helper.js';
import sequelize from './config/database.js';
import cron from 'node-cron';
import logger from './config/logger.js';

// Schedule the cron job to run every minute
// TODO: update to run every N minutes
const job = cron.schedule('* * * * *', async () => {
  logger.info('Cron job starting...');

  try {
    await sequelize.authenticate();



    // Cancel bookings created before 10 mins, but not paid
    const cancelTimeFilter = moment.utc().subtract(10, 'minutes');

    console.log("10 mins ago: " + cancelTimeFilter);
    const transactions = await getPendingTransactions(cancelTimeFilter);

    transactions.forEach((transaction) => {
      cancelTransaction(transaction);
    })
    



  } catch (error) {
    logger.error('Cron job error:', error);
  }

  logger.info('Cron job finishing...');
});

async function cancelTransaction(transaction) {
  try {
        
  } catch (error) {
    logger.error(`Error cancelling transaction: ${transaction.id}`, error); 
  }
}

job.start();
