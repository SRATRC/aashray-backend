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

  for (const transaction of pendingTransactions) {
    const bookingType = getBookingType(transaction);
    // TODO: optimize, get all bookings at once

    // Food bookings are handled in a special way
    if (bookingType != TYPE_FOOD) {
      const booking = await getBooking(bookingType, transaction.bookingid);
      if (booking) {
        bookings.push(booking);
      }
    }
    transactions.push(transaction);
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

const TICKET_AUTO_CLOSE_GRACE_DAYS = 7;

// A ticket an admin marked "resolved" auto-closes after sitting untouched for
// TICKET_AUTO_CLOSE_GRACE_DAYS with no further activity — matching how
// Zendesk (default 4 days) and Freshdesk (default 48h) separate the agent's
// "solved" action from the final "closed" state. A user reply to a resolved
// ticket moves it back to "in progress" (see ticket.controller.js), which
// resets updatedAt and pulls it out of this window; an admin follow-up
// message on an already-resolved ticket also refreshes updatedAt, restarting
// the countdown. Runs once daily — a 7-day window doesn't need finer polling.
const ticketAutoCloseJob = cron.schedule('0 2 * * *', async () => {
  logger.info('ticketAutoCloseJob cron job started.');
  try {
    const { Ticket } = await import('./models/associations.js');
    const { STATUS_RESOLVED, STATUS_CLOSED } = await import('./config/constants.js');
    const { notifyCardno } = await import('./helpers/notification.helper.js');

    const cutoff = moment().utc().subtract(TICKET_AUTO_CLOSE_GRACE_DAYS, 'days').toDate();

    const staleTickets = await Ticket.findAll({
      where: { status: STATUS_RESOLVED, updatedAt: { [Sequelize.Op.lt]: cutoff } }
    });

    if (staleTickets.length > 0) {
      // Single bulk UPDATE instead of one query per ticket — the per-row
      // write here has no row-specific logic that could fail differently per
      // ticket, so there's nothing gained from doing it one at a time.
      await Ticket.update(
        { status: STATUS_CLOSED, updatedBy: 'system:auto-close' },
        { where: { id: { [Sequelize.Op.in]: staleTickets.map((ticket) => ticket.id) } } }
      );

      // notifyCardno never throws (it catches internally and resolves with
      // {success, reason}), so Promise.allSettled here is purely to run the
      // notifications concurrently rather than one after another — a
      // fulfilled-but-unsuccessful result is inspected below, not a rejection.
      const notifyResults = await Promise.allSettled(
        staleTickets.map((ticket) =>
          notifyCardno(ticket.issued_by, {
            title: 'Support ticket closed',
            body: `Your ${ticket.service} ticket was automatically closed after ${TICKET_AUTO_CLOSE_GRACE_DAYS} days of inactivity`,
            screen: `/support/${ticket.id}`,
            data: { ticketId: ticket.id }
          })
        )
      );
      const failedNotifications = notifyResults.filter(
        (r) => r.status === 'rejected' || r.value?.success === false
      ).length;
      if (failedNotifications > 0) {
        logger.warn(
          `ticketAutoCloseJob: ${failedNotifications} of ${staleTickets.length} notifications failed (best-effort, non-fatal).`
        );
      }
    }

    logger.info(`ticketAutoCloseJob finished: closed ${staleTickets.length} ticket(s).`);
  } catch (error) {
    logger.error(`ticketAutoCloseJob error: ${error.stack || error.message}`);
  }
}, {
  scheduled: true,
  timezone: "Asia/Kolkata"
});

const ATTACHMENT_DELETE_CHUNK_SIZE = 1000; // S3 DeleteObjects hard limit per request

// Ticket media is auto-deleted ATTACHMENT_RETENTION_DAYS after upload. This
// daily job (mirrors ticketAutoCloseJob) selects non-expired attachments past
// the retention window, batch-deletes their S3 objects (chunked to S3's 1000
// keys/request limit, run concurrently under Promise.allSettled so one chunk's
// failure never aborts the rest), then tombstones every selected row by setting
// expired_at — kept so the UI can explain the gap and we never re-attempt.
// Rows are tombstoned even if their S3 delete failed; the bucket lifecycle rule
// is the backstop that reclaims any object that slipped through.
const ticketAttachmentCleanupJob = cron.schedule('30 2 * * *', async () => {
  logger.info('ticketAttachmentCleanupJob cron job started.');
  try {
    const { TicketAttachment } = await import('./models/associations.js');
    const { ATTACHMENT_RETENTION_DAYS } = await import('./config/constants.js');
    const { deleteObjects } = await import('./helpers/ticketAttachment.helper.js');

    const cutoff = moment().utc().subtract(ATTACHMENT_RETENTION_DAYS, 'days').toDate();

    const staleAttachments = await TicketAttachment.findAll({
      where: { expired_at: null, uploaded_at: { [Sequelize.Op.lt]: cutoff } }
    });

    if (staleAttachments.length > 0) {
      const keys = staleAttachments.map((a) => a.s3_key);
      const chunks = [];
      for (let i = 0; i < keys.length; i += ATTACHMENT_DELETE_CHUNK_SIZE) {
        chunks.push(keys.slice(i, i + ATTACHMENT_DELETE_CHUNK_SIZE));
      }

      const results = await Promise.allSettled(chunks.map((chunk) => deleteObjects(chunk)));

      let deleted = 0;
      let failed = 0;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          deleted += r.value?.deleted || 0;
          failed += r.value?.errors?.length || 0;
        } else {
          failed += 1;
        }
      }
      if (failed > 0) {
        logger.warn(
          `ticketAttachmentCleanupJob: ${failed} S3 delete failure(s) (best-effort; lifecycle rule is the backstop).`
        );
      }

      // Tombstone every selected row regardless of per-object S3 outcome.
      await TicketAttachment.update(
        { expired_at: new Date() },
        { where: { id: { [Sequelize.Op.in]: staleAttachments.map((a) => a.id) } } }
      );

      logger.info(
        `ticketAttachmentCleanupJob finished: deleted ${deleted} S3 object(s), tombstoned ${staleAttachments.length} attachment(s).`
      );
    } else {
      logger.info('ticketAttachmentCleanupJob finished: no attachments to expire.');
    }
  } catch (error) {
    logger.error(`ticketAttachmentCleanupJob error: ${error.stack || error.message}`);
  }
}, {
  scheduled: true,
  timezone: "Asia/Kolkata"
});

job.start();
mealsCount9PMJob.start();
mealsCount10PMJob.start();
mealsCount11PMJob.start();
wifiLowAlertJob.start();
ticketAutoCloseJob.start();
ticketAttachmentCleanupJob.start();

// Graceful shutdown handler
const gracefulShutdown = async () => {
  logger.info('cron_shutdown_initiated');

  // Stop future jobs from being triggered
  job.stop();
  mealsCount9PMJob.stop();
  mealsCount10PMJob.stop();
  mealsCount11PMJob.stop();
  wifiLowAlertJob.stop();
  ticketAutoCloseJob.stop();
  ticketAttachmentCleanupJob.stop();

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

