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
  TYPE_FOOD,
  TYPE_UTSAV,
  TYPE_ROOM,
  TYPE_FLAT,
  TYPE_TRAVEL
} from './config/constants.js';
import RoomBooking from './models/room_booking.model.js';
import AdminUsers from './models/admin_users.model.js';
import { cancelMeal } from './helpers/foodBooking.helper.js';
import FlatBooking from './models/flat_booking.model.js';
import { Sequelize } from 'sequelize';
import Transactions from './models/transactions.model.js';
import ShibirDb from './models/shibir_db.model.js';
import UtsavDb from './models/utsav_db.model.js';
import { sendCancellationEmail, sendOpenBookingEmail } from './helpers/mailer.helper.js';
import {
  getBooking,
  getBookings,
  getBookingType,
  getBookingTypeFromBooking
} from './helpers/booking.helper.js';
import { openAdhyayanSeat } from './helpers/adhyayanBooking.helper.js';
import { openUtsavSeat, cancelUtsavFoodBookings } from './helpers/utsavBooking.helper.js';
import { updateWaitingTravelBooking } from './helpers/travelBooking.helper.js';
import { sendAdhyayanStatusChangeWhatsApp, sendRoomStatusChangeWhatsApp, sendUtsavStatusChangeWhatsApp, sendFlatStatusChangeWhatsApp, sendTomorrowMealsCount, checkAndSendMealsCountUpdate } from './helpers/whatsapp.helper.js';
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
  const openBookings = {};
  const transactions = [];
  const bookings = [];

  await getUnpaidOnlineBookingsAndTransactions(bookings, transactions);
  // await getUnpaidPastBookingsAndTransactions(bookings, transactions);

  logger.info(`Cron cancelling bookings: ${JSON.stringify(bookings)}`);
  logger.info(`Cron cancelling transactions: ${JSON.stringify(transactions)}`);

  await cancelBookings(systemUser, bookings, userBookingIds, openBookings, t);
  await cancelTransactions(systemUser, transactions, t, true);
  await cancelMeals(systemUser, transactions, t);
  await t.commit();

  // Trigger WhatsApp notifications for cancelled bookings
  for (const booking of bookings) {
    const bookingType = getBookingTypeFromBooking(booking);
    if (bookingType === TYPE_ADHYAYAN) {
      try {
        await sendAdhyayanStatusChangeWhatsApp(booking, null, 'pending');
      } catch (waErr) {
        logger.error(`Error sending cron WhatsApp for Adhyayan: ${waErr.message}`);
      }
    } else if (bookingType === TYPE_ROOM) {
      try {
        await sendRoomStatusChangeWhatsApp(booking, 'pending', { isCron: true });
      } catch (waErr) {
        logger.error(`Error sending cron WhatsApp for Room: ${waErr.message}`);
      }
    } else if (bookingType === TYPE_UTSAV) {
      try {
        await sendUtsavStatusChangeWhatsApp(booking, 'payment pending', { isCron: true });
      } catch (waErr) {
        logger.error(`Error sending cron WhatsApp for Utsav: ${waErr.message}`);
      }
    } else if (bookingType === TYPE_FLAT) {
      try {
        await sendFlatStatusChangeWhatsApp(booking, 'payment pending', { isCron: true });
      } catch (waErr) {
        logger.error(`Error sending cron WhatsApp for Flat: ${waErr.message}`);
      }
    }
  }

  for (const cardno in userBookingIds) {
    const bookingIds = userBookingIds[cardno];
    await sendCancellationEmail(cardno, bookingIds, null);
  }
  for (const bookingType in openBookings) {
    const bookings = openBookings[bookingType];
    await sendOpenBookingEmail(bookingType, bookings);
  }
}

async function getUnpaidOnlineBookingsAndTransactions(bookings, transactions) {
  const cancelTimeFilter = moment
    .utc()
    .subtract(MAX_APP_PAYMENT_DURATION, 'minutes');
  const pendingTransactions = await getPendingTransactions(cancelTimeFilter);

  const bookingsByType = {};

  for (const transaction of pendingTransactions) {
    const bookingType = getBookingType(transaction);

    // Food bookings are handled in a special way
    if (bookingType != TYPE_FOOD) {
      if (!bookingsByType[bookingType]) {
        bookingsByType[bookingType] = new Set();
      }
      bookingsByType[bookingType].add(transaction.bookingid);
    }
    transactions.push(transaction);
  }

  for (const [bookingType, bookingIdsSet] of Object.entries(bookingsByType)) {
    const bookingIds = Array.from(bookingIdsSet);
    const fetchedBookings = await getBookings(bookingType, bookingIds);
    bookings.push(...fetchedBookings);
  }
}

async function cancelBookings(systemUser, bookings, userBookingIds, openBookings, t) {
  for (const booking of bookings) {
    const bookingType = getBookingTypeFromBooking(booking);

    switch (bookingType) {
      case TYPE_ADHYAYAN:
        const adhyayan = await ShibirDb.findOne({
          where: { id: booking.shibir_id }
        });

        let newBooking = await openAdhyayanSeat(
          adhyayan,
          systemUser.username,
          t
        );

        if (newBooking) {
          addToOpenBookings(openBookings, newBooking);

          // 🔥 CREATE ATTENDANCE FOR PROMOTED USER
          const { createShibirAttendanceEntry } = await import(
            './helpers/adhyayanBooking.helper.js'
          );

          await createShibirAttendanceEntry(
            newBooking,
            systemUser,
            t
          );
        }
        break;
      case TYPE_UTSAV:
        const utsav = await UtsavDb.findOne({
          where: { id: booking.utsavid }
        });
        //Not automatically moving from waiting to payment pending for now
        await cancelUtsavFoodBookings(booking, systemUser.username, t);
        await openUtsavSeat(utsav, booking.cardno, systemUser.username, t);


        break;
      case TYPE_TRAVEL:
        let newTravelBooking = await updateWaitingTravelBooking(booking, t);
        if (newTravelBooking) {
          addToOpenBookings(openBookings, newTravelBooking);
        }
        break;
    }

    await booking.update(
      {
        status: STATUS_ADMIN_CANCELLED,
        updatedBy: systemUser.username
      },
      { transaction: t }
    );

    // 🔥 ADD THIS
    if (bookingType === TYPE_ADHYAYAN) {
      const { resetShibirAttendance } = await import('./helpers/adhyayanBooking.helper.js');
      await resetShibirAttendance(
        booking.bookingid,
        systemUser.username,
        t
      );
    }
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

function addToOpenBookings(openBookings, booking) {
  const bookingType = getBookingTypeFromBooking(booking);
  const bookingsByType = openBookings[bookingType] || [];
  bookingsByType.push(booking);
  openBookings[bookingType] = bookingsByType;
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

// Schedule the new meals count notification cron jobs with Asia/Kolkata timezone
const mealsCount9PMJob = cron.schedule('0 21 * * *', async () => {
  logger.info('mealsCount9PMJob cron job started.');
  try {
    const recipients = ['0002849952', '0012754172', '0002823407'];
    await sendTomorrowMealsCount(recipients);
    logger.info('mealsCount9PMJob finished successfully.');
  } catch (error) {
    logger.error(`mealsCount9PMJob error: ${error.stack || error.message}`);
  }
}, {
  scheduled: true,
  timezone: "Asia/Kolkata"
});

const mealsCount10PMJob = cron.schedule('0 22 * * *', async () => {
  logger.info('mealsCount10PMJob cron job started.');
  try {
    await checkAndSendMealsCountUpdate();
    logger.info('mealsCount10PMJob finished successfully.');
  } catch (error) {
    logger.error(`mealsCount10PMJob error: ${error.stack || error.message}`);
  }
}, {
  scheduled: true,
  timezone: "Asia/Kolkata"
});

const mealsCount11PMJob = cron.schedule('0 23 * * *', async () => {
  logger.info('mealsCount11PMJob cron job started.');
  try {
    await checkAndSendMealsCountUpdate();
    logger.info('mealsCount11PMJob finished successfully.');
  } catch (error) {
    logger.error(`mealsCount11PMJob error: ${error.stack || error.message}`);
  }
}, {
  scheduled: true,
  timezone: "Asia/Kolkata"
});

let isWifiJobRunning = false;
let isLowWifiAlertSent = false;

// Schedule WiFi low code alert cron job to run every 30 minutes
const wifiLowAlertJob = cron.schedule('*/30 * * * *', async () => {
  logger.info('WiFi low code alert check cron job started.');
  isWifiJobRunning = true;

  try {
    const { WifiDb } = await import('./models/associations.js');
    const { STATUS_ACTIVE } = await import('./config/constants.js');
    const { sendWifiLowAlertWhatsApp } = await import('./helpers/whatsapp.helper.js');

    const count = await WifiDb.count({
      where: { status: STATUS_ACTIVE }
    });

    logger.info(`WiFi low code alert check: ${count} active codes remaining.`);

    if (count < 50) {
      if (!isLowWifiAlertSent) {
        await sendWifiLowAlertWhatsApp(count);
        isLowWifiAlertSent = true;
      }
    } else {
      isLowWifiAlertSent = false;
    }
  } catch (error) {
    logger.error(`WiFi low code alert check error: ${error.message}`);
  } finally {
    isWifiJobRunning = false;
    logger.info('WiFi low code alert check cron job finished.');
  }
});

job.start();
mealsCount9PMJob.start();
mealsCount10PMJob.start();
mealsCount11PMJob.start();
wifiLowAlertJob.start();

// Graceful shutdown handler
const gracefulShutdown = async () => {
  logger.info('cron_shutdown_initiated');

  // Stop future jobs from being triggered
  job.stop();
  mealsCount9PMJob.stop();
  mealsCount10PMJob.stop();
  mealsCount11PMJob.stop();
  wifiLowAlertJob.stop();

  // Wait for the current task to finish if it's running
  const waitInterval = setInterval(() => {
    if (!isRunning && !isWifiJobRunning) {
      logger.info('cron_shutdown_complete');
      clearInterval(waitInterval);
      process.exit(0);
    } else {
      logger.info('cron_shutdown_waiting_for_task');
    }
  }, 10000);
};

process.on('SIGINT', gracefulShutdown); // e.g., Ctrl+C
process.on('SIGTERM', gracefulShutdown); // PM2 stop/reload

