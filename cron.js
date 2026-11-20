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
  TYPE_TRAVEL,
  MAX_APP_PAYMENT_DURATION_MINUTES
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
import { openUtsavSeat, utsavBookingHeldSeat, cancelUtsavFoodBookings } from './helpers/utsavBooking.helper.js';
import { updateWaitingTravelBooking } from './helpers/travelBooking.helper.js';
import { sendAdhyayanStatusChangeWhatsApp, sendRoomStatusChangeWhatsApp, sendUtsavStatusChangeWhatsApp, sendFlatStatusChangeWhatsApp, sendTomorrowMealsCount, checkAndSendMealsCountUpdate } from './helpers/whatsapp.helper.js';

let isRunning = false; // Track task status

// Schedule the cron job to run every 30 minutes
const job = cron.schedule('*/30 * * * *', async () => {
  // A sweep can outlast the 30-minute interval. A second run started on top
  // of it reads the same unpaid bookings before the first commits them, and
  // cancels them again, handing their seats back twice.
  if (isRunning) {
    logger.warn('Cron job skipped: previous run still in progress.');
    return;
  }
  logger.info('Cron job started.');
  isRunning = true;

  // runJob owns its own (per-item) transactions now, so there is nothing for
  // the scheduler to roll back. try/finally instead of .finally() so isRunning
  // is always cleared — with the setup outside the old promise chain, a throw
  // from authenticate() left the flag stuck on and hung graceful shutdown.
  try {
    await database.authenticate();

    const systemUser = await AdminUsers.findOne({
      where: { username: 'admin' }
    });

    await runJob(systemUser);
    logger.info('Cron job finished.');
  } catch (error) {
    logger.error(`Cron job error: ${JSON.stringify(error.stack)}`);
  } finally {
    isRunning = false;
  }
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

async function runJob(systemUser) {
  const userBookingIds = {};
  const openBookings = {};
  const bookings = [];

  const items = await getUnpaidOnlineBookingsAndTransactions();
  // await getUnpaidPastBookingsAndTransactions(bookings, transactions);
  // ^ still returns the old two-array shape; convert it to items before
  //   re-enabling it, otherwise its rows never reach the per-item sweep below.

  logger.info(
    `Cron cancelling bookings: ${JSON.stringify(
      items.map((item) => item.booking).filter(Boolean)
    )}`
  );
  logger.info(
    `Cron cancelling transactions: ${JSON.stringify(
      items.map((item) => item.transaction)
    )}`
  );

  // One transaction per item instead of one for the whole sweep. The event-row
  // FOR UPDATE locks mean a sweep-wide transaction held a write lock on every
  // affected event and every affected member card until the very end, so
  // members booking those events blocked or hit a lock timeout for as long as
  // the sweep ran. Each item is still atomic — its booking, its transaction
  // and its meals commit or roll back together — but a failure now only loses
  // that item, and the items already committed stay applied.
  for (const { booking, transaction } of items) {
    const t = await database.transaction();

    // Collected inside the item transaction, published to the shared maps
    // below only once that transaction has committed — otherwise a rolled-back
    // item would still be emailed and WhatsApped as cancelled.
    const itemOpenBookings = {};

    let fresh;
    try {
      fresh = await lockAndRecheckItem(booking, transaction, t);
      if (!fresh) {
        await t.rollback();
        logger.info(
          `Cron item skipped for bookingid ${transaction.bookingid}: paid or cancelled since the sweep read it`
        );
        continue;
      }
      if (fresh.booking) {
        await cancelBookings(systemUser, [fresh.booking], itemOpenBookings, t);
      }
      await cancelTransactions(systemUser, [fresh.transaction], t, true);
      await cancelMeals(systemUser, [fresh.transaction], t);
      await t.commit();
    } catch (error) {
      try {
        await t.rollback();
      } catch (rollbackError) {
        logger.error(
          `Cron item rollback failed for bookingid ${transaction.bookingid}: ${rollbackError.message}`
        );
      }
      logger.error(
        `Cron item cancel failed for bookingid ${transaction.bookingid}: ${
          error.stack || error.message
        }`
      );
      continue;
    }

    // Past the commit, so a throw here would escape the catch above and kill
    // the rest of the sweep. The item itself is already durable — only its
    // notification bookkeeping can fail, so log it and carry on.
    try {
      // The re-read copy is the one cancelBookings updated; the sweep's
      // original copy still says pending.
      if (fresh.booking) {
        bookings.push(fresh.booking);
        addToUserBookingIdMap(userBookingIds, fresh.booking);
      }
      for (const bookingType in itemOpenBookings) {
        for (const openedBooking of itemOpenBookings[bookingType]) {
          addToOpenBookings(openBookings, openedBooking);
        }
      }
    } catch (error) {
      logger.error(
        `Cron item cancelled but notification bookkeeping failed for bookingid ${
          transaction.bookingid
        }: ${error.stack || error.message}`
      );
    }
  }

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

// The sweep reads every unpaid item up front, before any item's transaction
// starts. A payment or a member cancel can land in between; acting on the old
// copy then cancels a booking that was just paid, or hands its seat back twice.
// Lock and re-read the item inside its own transaction — event row, then
// payment row, then booking, the same order the member cancel and the payment
// confirmation use — and return null if either row has moved on.
async function lockAndRecheckItem(booking, transaction, t) {
  if (booking) {
    const bookingType = getBookingTypeFromBooking(booking);
    if (bookingType === TYPE_UTSAV) {
      await UtsavDb.findOne({ where: { id: booking.utsavid }, transaction: t, lock: t.LOCK.UPDATE });
    } else if (bookingType === TYPE_ADHYAYAN) {
      await ShibirDb.findOne({ where: { id: booking.shibir_id }, transaction: t, lock: t.LOCK.UPDATE });
    }
  }

  const freshTransaction = await Transactions.findOne({
    where: { id: transaction.id },
    transaction: t,
    lock: t.LOCK.UPDATE
  });
  if (!freshTransaction || freshTransaction.status !== transaction.status) return null;

  let freshBooking = null;
  if (booking) {
    freshBooking = await booking.constructor.findOne({
      where: { bookingid: booking.bookingid },
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    if (!freshBooking || freshBooking.status !== booking.status) return null;
  }

  return { booking: freshBooking, transaction: freshTransaction };
}

// Returns the sweep as a list of { transaction, booking } items. One item is
// the unit of work for one database transaction, so a booking is paired with
// the pending transaction it belongs to. booking is null for food, which has
// no booking row of its own and is cancelled from the transaction instead.
async function getUnpaidOnlineBookingsAndTransactions() {
  const cancelTimeFilter = moment
    .utc()
    .subtract(MAX_APP_PAYMENT_DURATION_MINUTES, 'minutes');
  const pendingTransactions = await getPendingTransactions(cancelTimeFilter);

  const items = [];

  for (const transaction of pendingTransactions) {
    const bookingType = getBookingType(transaction);
    // TODO: optimize, get all bookings at once

    // Food bookings are handled in a special way
    let booking = null;
    if (bookingType != TYPE_FOOD) {
      booking = await getBooking(bookingType, transaction.bookingid);
    }
    items.push({ transaction, booking });
  }

  return items;
}

// userBookingIds is no longer collected here: the caller adds each booking to
// it after that booking's own transaction has committed.
async function cancelBookings(systemUser, bookings, openBookings, t) {
  for (const booking of bookings) {
    const bookingType = getBookingTypeFromBooking(booking);

    switch (bookingType) {
      case TYPE_ADHYAYAN:
        const adhyayan = await ShibirDb.findOne({
          where: { id: booking.shibir_id },
          transaction: t,
          lock: t.LOCK.UPDATE
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
        //Not automatically moving from waiting to payment pending for now
        // Only a booking that held a seat was given utsav meals; waiting-list
        // bookings never are. The cleanup clears every meal in the package dates,
        // so running it for a booking that never had them wipes meals the member
        // booked on their own for those days.
        if (utsavBookingHeldSeat(booking.status)) {
          await cancelUtsavFoodBookings(booking, systemUser.username, t);
        }

        // booking.status is still the pre-cancel status here: the update to
        // 'admin cancelled' happens after this switch. A waiting-list booking
        // never held a seat, so cancelling it must not hand one back — and
        // when no seat is freed there is no reason to take the utsav row lock
        // at all.
        if (utsavBookingHeldSeat(booking.status)) {
          const utsav = await UtsavDb.findOne({
            where: { id: booking.utsavid },
            transaction: t,
            lock: t.LOCK.UPDATE
          });
          await openUtsavSeat(utsav, booking.cardno, systemUser.username, t);
        }

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

    let closedCount = 0;
    if (staleTickets.length > 0) {
      // Single bulk UPDATE instead of one query per ticket — the per-row
      // write here has no row-specific logic that could fail differently per
      // ticket, so there's nothing gained from doing it one at a time.
      // Re-check status and idle time in the UPDATE itself: a member reply
      // between the SELECT above and this write moves the ticket to
      // "in progress" and must not be closed.
      const closeWhere = {
        id: { [Sequelize.Op.in]: staleTickets.map((ticket) => ticket.id) },
        status: STATUS_RESOLVED,
        updatedAt: { [Sequelize.Op.lt]: cutoff }
      };
      await Ticket.update(
        { status: STATUS_CLOSED, updatedBy: 'system:auto-close' },
        { where: closeWhere }
      );
      // Notify only the tickets this run actually closed.
      const closedTickets = await Ticket.findAll({
        where: {
          id: { [Sequelize.Op.in]: staleTickets.map((ticket) => ticket.id) },
          status: STATUS_CLOSED,
          updatedBy: 'system:auto-close'
        }
      });
      closedCount = closedTickets.length;
      const toNotify = closedTickets;

      // notifyCardno never throws (it catches internally and resolves with
      // {success, reason}), so Promise.allSettled here is purely to run the
      // notifications concurrently rather than one after another — a
      // fulfilled-but-unsuccessful result is inspected below, not a rejection.
      const notifyResults = await Promise.allSettled(
        toNotify.map((ticket) =>
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
          `ticketAutoCloseJob: ${failedNotifications} of ${toNotify.length} notifications failed (best-effort, non-fatal).`
        );
      }
    }

    logger.info(`ticketAutoCloseJob finished: closed ${closedCount} of ${staleTickets.length} stale ticket(s).`);
  } catch (error) {
    logger.error(`ticketAutoCloseJob error: ${error.stack || error.message}`);
  }
}, {
  scheduled: true,
  timezone: "Asia/Kolkata"
});

// Ticket media is auto-deleted ATTACHMENT_RETENTION_DAYS after upload. This
// daily job (mirrors ticketAutoCloseJob) selects non-expired attachments past
// the retention window and batch-deletes their S3 objects via deleteObjects
// (which chunks internally to S3's 1000-keys/request limit and never throws —
// returns { deleted, errors } — so one object's failure never aborts the rest),
// then tombstones every selected row by setting expired_at — kept so the UI can
// explain the gap and we never re-attempt. Rows are tombstoned even if their S3
// delete failed; the bucket lifecycle rule is the backstop that reclaims any
// object that slipped through.
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

      const { deleted, errors } = await deleteObjects(keys);
      if (errors.length > 0) {
        logger.warn(
          `ticketAttachmentCleanupJob: ${errors.length} S3 delete failure(s) (best-effort; lifecycle rule is the backstop).`
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

