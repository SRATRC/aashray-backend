import './config/environment.js';
import moment from 'moment';
import {
  cancelTransactions,
  getPendingTransactions
} from './helpers/transactions.helper.js';
import database from './config/database.js';
import cron from 'node-cron';
import logger from './config/logger.js';
import {
  STATUS_ADMIN_CANCELLED,
  STATUS_PAYMENT_PENDING,
  TYPE_ADHYAYAN,
  TYPE_FOOD
} from './config/constants.js';
import RoomBooking from './models/room_booking.model.js';
import AdminUsers from './models/admin_users.model.js';
import { cancelMeal } from './helpers/foodBooking.helper.js';
import FlatBooking from './models/flat_booking.model.js';
import { Sequelize } from 'sequelize';
import Transactions from './models/transactions.model.js';
import ShibirDb from './models/shibir_db.model.js';
import UtsavDb from './models/utsav_db.model.js';
import { sendCancellationEmail } from './helpers/mailer.helper.js';
import {
  getBooking,
  getBookingType,
  getBookingTypeFromBooking
} from './helpers/booking.helper.js';
import { openAdhyayanSeat } from './helpers/adhyayanBooking.helper.js';
import { openUtsavSeat } from './helpers/utsavBooking.helper.js';
const MAX_APP_PAYMENT_DURATION = 24 * 60; // 24 hrs

let isRunning = false; // Track task status

// Schedule the cron job to run every 30 minutes
const job = cron.schedule('*/30 * * * *', async () => {
  logger.info('Cron job started.');
  isRunning = true;

  await database.authenticate();

  const systemUser = await AdminUsers.findOne({
    where: { username: 'admin' }
  });

  const t = await database.transaction();

  runJob(systemUser, t)
    .then(() => {
      logger.info('Cron job finished.');
    })
    .catch((error) => {
      logger.error(`Cron job error: ${JSON.stringify(error.stack)}`);
      t.rollback();
    })
    .finally(() => {
      isRunning = false;
    });
});

async function cancelMeals(systemUser, transactions, t) {
  for (const transaction of transactions) {
    const bookingType = getBookingType(transaction);
    if (bookingType == TYPE_FOOD) {
      await cancelMeal(
        systemUser,
        transaction.bookingid,
        transaction.category,
        t
      );
    }
  }
}

async function runJob(systemUser, t) {
  const userBookingIds = {};
  const transactions = [];
  const bookings = [];

  await getUnpaidOnlineBookingsAndTransactions(bookings, transactions);
  // await getUnpaidPastBookingsAndTransactions(bookings, transactions);

  logger.info(`Cron cancelling bookings: ${JSON.stringify(bookings)}`);
  logger.info(`Cron cancelling transactions: ${JSON.stringify(transactions)}`);

  await cancelBookings(systemUser, bookings, userBookingIds, t);
  await cancelTransactions(systemUser, transactions, t, true);
  await cancelMeals(systemUser, transactions, t);
  await t.commit();

  for (const cardno in userBookingIds) {
    const bookingIds = userBookingIds[cardno];
    await sendCancellationEmail(cardno, bookingIds, null);
  }
}

async function getUnpaidOnlineBookingsAndTransactions(bookings, transactions) {
  const cancelTimeFilter = moment
    .utc()
    .subtract(MAX_APP_PAYMENT_DURATION, 'minutes');
  const pendingTransactions = await getPendingTransactions(cancelTimeFilter);

  for (const transaction of pendingTransactions) {
    const bookingType = getBookingType(transaction);
    // TODO: optimize, get all bookings at once

    // Food bookings are handled in a special way
    if (bookingType != TYPE_FOOD) {
      const booking = await getBooking(bookingType, transaction.bookingid);
      bookings.push(booking);
    }
    transactions.push(transaction);
  }
}

async function cancelBookings(systemUser, bookings, userBookingIds, t) {
  for (const booking of bookings) {
    const bookingType = getBookingTypeFromBooking(booking);

    switch (bookingType) {
      case TYPE_ADHYAYAN:
        const adhyayan = await ShibirDb.findOne({
          where: { id: booking.shibir_id }
        });
        await openAdhyayanSeat(adhyayan, systemUser.username, t);
        break;
      case TYPE_UTSAV:
        const utsav = await UtsavDb.findOne({
          where: { id: booking.utsavid }
        });
        await openUtsavSeat(utsav, booking.cardno, systemUser.username, t);
        break;
    }

    await booking.update(
      {
        status: STATUS_ADMIN_CANCELLED,
        updatedBy: systemUser.username
      },
      { transaction: t }
    );
    addToUserBookingIdMap(userBookingIds, booking);
  }
}

function addToUserBookingIdMap(userBookingIds, booking) {
  const bookingType = getBookingTypeFromBooking(booking);
  const cardno = booking.cardno;

  const bookingIdsByType = userBookingIds[cardno] || {};
  const bookingIds = bookingIdsByType[bookingType] || [];

  bookingIds.push(booking.bookingid);
  bookingIdsByType[bookingType] = bookingIds;
  userBookingIds[cardno] = bookingIdsByType;
}

async function getUnpaidPastBookingsAndTransactions(bookings, transactions) {
  const pastBookings = await getUnpaidPastBookings();

  const pastTransactions = await Transactions.findAll({
    where: { bookingid: pastBookings.map((i) => i.bookingid) }
  });

  bookings.push(...pastBookings);
  transactions.push(...pastTransactions);
}

async function getUnpaidPastBookings() {
  const today = moment().utc().format('YYYY-MM-DD');

  const roomBookings = await RoomBooking.findAll({
    where: {
      status: STATUS_PAYMENT_PENDING,
      checkin: { [Sequelize.Op.lt]: today }
    }
  });

  const flatBookings = await FlatBooking.findAll({
    where: {
      status: STATUS_PAYMENT_PENDING,
      checkin: { [Sequelize.Op.lt]: today }
    }
  });

  return [...roomBookings, ...flatBookings];
}

/* ==============================
 * Job start and shutdown handler
 * ==============================
 */

job.start();

// Graceful shutdown handler
const gracefulShutdown = async () => {
  console.log('Gracefully shutting down cron service...');

  // Stop future jobs from being triggered
  job.stop();

  // Wait for the current task to finish if it's running
  const waitInterval = setInterval(() => {
    if (!isRunning) {
      console.log('All tasks completed. Exiting...');
      clearInterval(waitInterval);
      process.exit(0);
    } else {
      console.log('Waiting for current task to finish...');
    }
  }, 10000);
};

process.on('SIGINT', gracefulShutdown); // e.g., Ctrl+C
process.on('SIGTERM', gracefulShutdown); // PM2 stop/reload
