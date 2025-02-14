import './config/environment.js';
import { 
  cancelPendingBookings 
} from './helpers/transactions.helper.js';
import sequelize from './config/database.js';
import cron from 'node-cron';

// Schedule the cron job to run every minute
// TODO: update to run every N minutes
const job = cron.schedule('* * * * *', async () => {

  console.log('Cron job starting...');

  try {
    await sequelize.authenticate();

    await cancelPendingBookings();
  } catch (error) {
    console.error('Unable to connect to the database:', error);
  }

  console.log('Cron job finishing...');
});

job.start();