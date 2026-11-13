import {
  ERR_ADHYAYAN_ALREADY_BOOKED,
  ERR_ADHYAYAN_NO_SEATS_AVAILABLE,
  ERR_ADHYAYAN_NOT_COMPLETED,
  ERR_ADHYAYAN_NOT_FOUND,
  ERR_BOOKING_NOT_FOUND,
  ERR_FEEDBACK_NOT_ALLOWED,
  STATUS_CONFIRMED,
  STATUS_OPEN,
  STATUS_PAYMENT_PENDING,
  STATUS_WAITING,
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED,
  TYPE_ADHYAYAN,
  STATUS_CASH_COMPLETED,
  ERR_FEEDBACK_ALREADY_SUBMITTED,
  FEEDBACK_ELIGIBILITY_HOUR,
  RESEARCH_CENTRE,
  STATUS_DELETED,
  EXCLUDED_ATTENDANCE_SPEAKER_PATTERN,
  EXCLUDED_ATTENDANCE_SPEAKER_SUBSTRING
} from '../config/constants.js';
import database from '../config/database.js';
import {
  AdhyayanFeedback,
  ShibirBookingDb,
  ShibirDb,
  UtsavPackagesDb,
  CardDb,
  ShibirAttendanceDb,
  ShibirSession,
  ShibirAttendanceRecord
} from '../models/associations.js';
import sendMail from '../utils/sendMail.js';
import { v4 as uuidv4 } from 'uuid';
import { createPendingTransaction } from './transactions.helper.js';
import { validateCard, validateCards } from './card.helper.js';
import ApiError from '../utils/ApiError.js';
import moment from 'moment-timezone';
import Sequelize from 'sequelize';
import { sendDualUserNotifications } from './notification.helper.js';
import { sendAdhyayanStatusChangeWhatsApp } from './whatsapp.helper.js';
import logger from '../config/logger.js';

export async function bookAdhyayanForMumukshus(
  shibir_ids,
  mumukshus,
  t,
  user,
  log = logger
) {
  log.info('adhyayan_booking_start', {
    shibir_ids,
    mumukshu_count: mumukshus.length,
    bookedBy: user.cardno
  });
  await validateCards(mumukshus);
  await checkAdhyayanAlreadyBooked(shibir_ids, mumukshus);
  const shibirs = await validateAdhyayans(shibir_ids);

  const result = await createAdhyayanBooking(
    shibirs,
    t,
    user,
    ...mumukshus,
    log
  );

  return result;
}

export async function checkAdhyayanAlreadyBooked(shibirIds, ...users) {
  const booking = await ShibirBookingDb.findOne({
    where: {
      shibir_id: shibirIds,
      cardno: users,
      status: [STATUS_CONFIRMED, STATUS_WAITING, STATUS_PAYMENT_PENDING]
    }
  });

  if (booking) {
    throw new ApiError(400, ERR_ADHYAYAN_ALREADY_BOOKED);
  }
}

export async function checkAdhyayanParamGyanSabhaOrUtsav(date) {
  const adhyayan = await ShibirDb.findOne({
    attributes: ['name', 'speaker'],
    where: {
      name: 'Param Gyaan Sabha',
      start_date: date
    }
  });

  if (adhyayan) {
    return true;
  }

  const utsavPackage = await UtsavPackagesDb.findOne({
    where: {
      [Sequelize.Op.or]: [{ start_date: date }, { end_date: date }]
    }
  });

  if (utsavPackage) {
    return true;
  }

  return false;
}

export async function validateAdhyayans(...shibirIds) {
  const sevenDaysAgo = moment().tz('Asia/Kolkata').subtract(15, 'days').format('YYYY-MM-DD');

  const shibirs = await ShibirDb.findAll({
    where: {
      id: shibirIds,
      start_date: {
        [Sequelize.Op.gte]: sevenDaysAgo
      }
    }
  });

  if (shibirs.length != shibirIds.length) {
    throw new ApiError(400, ERR_ADHYAYAN_NOT_FOUND);
  }

  return shibirs;
}

export async function validateAdhyayanBooking(bookingId, shibirId) {
  const booking = await ShibirBookingDb.findOne({
    where: {
      shibir_id: shibirId,
      bookingid: bookingId
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  return booking;
}

export async function createAdhyayanBooking(adhyayans, t, user, ...users) {
  // Last arg may be our log instance (non-string, non-cardno)
  let log = logger;
  const lastArg = users[users.length - 1];
  if (
    lastArg &&
    typeof lastArg === 'object' &&
    typeof lastArg.info === 'function'
  ) {
    log = users.pop();
  }
  let amount = 0,
    waitingBookingCount = 0;
  const userBookingIds = {};

  for (const booking_user of users) {
    const bookingIds = [];
    for (const adhyayan of adhyayans) {
      const bookingId = uuidv4();

      // Confirmed-vs-waitlist is decided by whether the seat was actually
      // taken under the row lock, not by the unlocked count that
      // validateAdhyayans loaded. Each person in a group re-reads the locked
      // row inside this same transaction, so N people decrement by N and the
      // rest spill to the waitlist the moment the seats run out.
      const seatReserved =
        adhyayan.status == STATUS_OPEN
          ? await reserveAdhyayanSeat(adhyayan, t, log)
          : false;

      if (seatReserved) {
        const booking = await ShibirBookingDb.create(
          {
            bookingid: bookingId,
            cardno: booking_user,
            bookedBy: user.cardno !== booking_user ? user.cardno : null,
            shibir_id: adhyayan.id,
            status:
              adhyayan.amount > 0 ? STATUS_PAYMENT_PENDING : STATUS_CONFIRMED,
            updatedBy: user.cardno
          },
          { transaction: t }
        );

        log.info('adhyayan_seat_reserved', {
          bookingid: bookingId,
          cardno: booking_user,
          shibir_id: adhyayan.id,
          status: booking.status
        });

        if (
          [STATUS_CONFIRMED, STATUS_PAYMENT_PENDING].includes(booking.status)
        ) {
          await createShibirAttendanceEntry(booking, user, t);
        }
        if (adhyayan.amount > 0) {
          const { discountedAmount } = await createPendingTransaction(
            user,
            booking,
            TYPE_ADHYAYAN,
            adhyayan.amount,
            user.cardno,
            t
          );

          amount += discountedAmount;
        }
      } else {
        await ShibirBookingDb.create(
          {
            bookingid: bookingId,
            cardno: booking_user,
            bookedBy: user.cardno !== booking_user ? user.cardno : null,
            shibir_id: adhyayan.id,
            status: STATUS_WAITING,
            updatedBy: user.cardno
          },
          { transaction: t }
        );
        log.info('adhyayan_seat_waiting', {
          bookingid: bookingId,
          cardno: booking_user,
          shibir_id: adhyayan.id
        });
        waitingBookingCount++;
      }
      bookingIds.push(bookingId);
    }
    userBookingIds[booking_user] = bookingIds;
  }

  return { amount, userBookingIds, waitingBookingCount };
}

// Takes the seat, or reports that there was none to take.
//
// The seat count is re-read here under a row lock instead of trusting the
// instance handed in by validateAdhyayans, which is loaded with no transaction
// and no lock. Two requests racing for the last seat both used to read
// available_seats = 1, both passed the caller's check, and both wrote 0 — two
// confirmed bookings for one seat, with the counter showing nothing wrong.
//
// Returns true if a seat was taken, false if the session is full. Callers must
// branch on the return value rather than on their own stale read, so that the
// decision and the decrement come from the same locked row.
export async function reserveAdhyayanSeat(adhyayan, t, log = logger) {
  const freshAdhyayan = await ShibirDb.findOne({
    where: { id: adhyayan.id },
    transaction: t,
    lock: t ? t.LOCK.UPDATE : undefined
  });

  if (!freshAdhyayan) {
    throw new ApiError(404, ERR_ADHYAYAN_NOT_FOUND);
  }

  if (freshAdhyayan.available_seats <= 0) {
    log.debug('adhyayan_seat_unavailable', { shibir_id: adhyayan.id });
    return false;
  }

  const newSeats = freshAdhyayan.available_seats - 1;

  await freshAdhyayan.update(
    {
      available_seats: newSeats
    },
    { transaction: t }
  );

  // Keep the in-memory instance in sync — callers read it after this returns.
  adhyayan.available_seats = newSeats;

  log.debug('adhyayan_seat_decremented', {
    shibir_id: adhyayan.id,
    remaining: newSeats
  });

  return true;
}

export async function openAdhyayanSeat(adhyayan, updatedBy, t, log = logger) {
  const booking = await ShibirBookingDb.findOne({
    where: {
      shibir_id: adhyayan.id,
      status: STATUS_WAITING
    },
    order: [['createdAt', 'ASC']],
    // Run the lookup inside the caller's transaction so sequential promotions
    // in the same run (e.g. cron cancelling several bookings for one shibir)
    // see each other's uncommitted WAITING -> PAYMENT_PENDING update, and take
    // a row lock so any concurrent promotion for the same shibir blocks until
    // this transaction commits. Without this, the same waiting booking gets
    // promoted twice, creating duplicate transactions for one bookingid.
    transaction: t,
    lock: t.LOCK.UPDATE
  });

  if (booking) {
    const isFree = Number(adhyayan.amount) === 0;
    const newStatus = isFree ? STATUS_CONFIRMED : STATUS_PAYMENT_PENDING;

    // Preserve booker attribution on promotion: keep the original bookedBy
    // (already set at creation) and record who triggered the promotion.
    await booking.update(
      {
        status: newStatus,
        bookedBy: booking.bookedBy,
        updatedBy
      },
      { transaction: t }
    );

    // Only create a pending transaction if the shibir has charges
    if (!isFree) {
      // for a booking in waiting status, there should be no existing transaction
      const bookedBy = booking.bookedBy || booking.cardno;
      const card = await validateCard(bookedBy);
      await createPendingTransaction(
        card,
        booking,
        TYPE_ADHYAYAN,
        adhyayan.amount,
        updatedBy,
        t
      );
    }

    log.info('adhyayan_waitlist_promoted', {
      bookingid: booking.bookingid,
      cardno: booking.cardno,
      shibir_id: adhyayan.id,
      status: newStatus,
      isFree
    });
    await createShibirAttendanceEntry(booking, { username: updatedBy }, t);
    return booking;
  } else {
    const freshAdhyayan = await ShibirDb.findOne({
      where: { id: adhyayan.id },
      transaction: t,
      lock: t ? t.LOCK.UPDATE : undefined
    });

    if (!freshAdhyayan) {
      throw new ApiError(404, ERR_ADHYAYAN_NOT_FOUND);
    }

    const newSeats = Math.min(freshAdhyayan.total_seats, freshAdhyayan.available_seats + 1);

    await freshAdhyayan.update(
      {
        available_seats: newSeats
      },
      { transaction: t }
    );
    adhyayan.available_seats = newSeats;
    log.debug('adhyayan_seat_opened_no_waiting', { shibir_id: adhyayan.id });
    return null;
  }
}

export async function sendAdhyayanBookingUpdateNotification(
  newBooking,
  adhyayan,
  isfromAdmin,
  previousStatus
) {
  // Build card numbers array efficiently and fetch all cards in single query
  const cardNumbers = [newBooking.cardno, newBooking.bookedBy].filter(Boolean);
  const cards = await CardDb.findAll({ where: { cardno: cardNumbers } });

  if (!adhyayan) {
    adhyayan = await ShibirDb.findOne({ where: { id: newBooking.shibir_id } });
  }

  // Create lookup map for O(1) access
  const cardMap = new Map(cards.map((card) => [card.cardno, card]));
  const card = cardMap.get(newBooking.cardno);
  const bookedByCard = newBooking.bookedBy
    ? cardMap.get(newBooking.bookedBy)
    : null;

  // Early return if no card
  if (!card) return;
  let adminBody = '';
  if (isfromAdmin) {
    adminBody = ' by an Admin';
  }
  let adhyanName = adhyayan.name;
  // Status message mapping
  const statusMessages = {
    [STATUS_PAYMENT_PENDING]:
      'has been pending ' +
      adminBody +
      ' and you are requested to make payment within 24 hours to secure your spot.',
    [STATUS_CONFIRMED]:
      'has been confirmed ' + adminBody + ' for ' + adhyanName + '.',
    [STATUS_WAITING]:
      'has been placed on the waiting list for ' +
      adhyanName +
      ' and will be notified if a spot becomes available.' +
      adminBody +
      '.',
    [STATUS_CANCELLED]: 'has been cancelled for ' + adhyanName + '.',
    [STATUS_ADMIN_CANCELLED]:
      'has been cancelled by an Admin for ' + adhyanName + '.'
  };

  const messageBody = statusMessages[newBooking.status] || 'has been updated.';
  const userName = card.issuedto;

  // Send notifications
  sendDualUserNotifications({
    primary: {
      token: card.token,
      title: 'Adhyayan Booking Updated',
      body: `Your adhyayan ${messageBody}`
    },
    bookedBy: bookedByCard && {
      token: bookedByCard.token,
      title: 'Adhyayan Booking Updated',
      body: `Adhyayan booking for ${userName} ${messageBody}`
    },
    screen: '/bookings'
  });

  // Send email if email exists
  if (card.email) {
    sendMail({
      email: card.email,
      cc: bookedByCard?.email,
      subject: 'Raj Adhyayan Booking Updated',
      template: 'rajAdhyayanUpdate',
      context: {
        name: card.issuedto,
        bookingid: newBooking.bookingid,
        status: newBooking.status,
        adhyayanName: adhyayan.name,
        adhyayanStartDate: adhyayan.start_date,
        adhyayanEndDate: adhyayan.end_date
      }
    });
  }

  // Send WhatsApp messages for status transitions
  await sendAdhyayanStatusChangeWhatsApp(newBooking, adhyayan, previousStatus);
}

export async function checkAdhyayanAvailabilityForMumukshus(
  shibir_ids,
  mumukshus
) {
  await validateCards(mumukshus);
  await checkAdhyayanAlreadyBooked(shibir_ids, mumukshus);
  const shibirs = await validateAdhyayans(shibir_ids);

  var adhyayanDetails = [];
  for (var shibir of shibirs) {
    var available = 0;
    var waiting = 0;
    var charge = 0;

    if (shibir.status == STATUS_OPEN) {
      available = Math.min(shibir.available_seats, mumukshus.length);
      charge = available * shibir.amount;
      waiting = mumukshus.length - available;
    } else {
      waiting = mumukshus.length;
    }

    adhyayanDetails.push({
      shibirId: shibir.dataValues.id,
      available: available,
      waiting: waiting,
      charge: charge
    });
  }

  return adhyayanDetails;
}

export async function validateFeedbackEligibility(cardno, shibir_id) {
  const adhyayan = await ShibirDb.findOne({
    where: { id: shibir_id }
  });

  if (!adhyayan) {
    throw new ApiError(404, ERR_ADHYAYAN_NOT_FOUND);
  }

  const now = moment().tz('Asia/Kolkata');
  const feedbackStartDate = moment(adhyayan.start_date)
    .tz('Asia/Kolkata')
    .hour(FEEDBACK_ELIGIBILITY_HOUR)
    .minute(0)
    .second(0);

  // Check if feedback period has started
  if (now.isBefore(feedbackStartDate)) {
    throw new ApiError(400, ERR_ADHYAYAN_NOT_COMPLETED);
  }

  // Check if more than 15 days have passed since adhyayan ended
  const daysSinceEnd = now.diff(feedbackStartDate, 'days');
  if (daysSinceEnd > 15) {
    throw new ApiError(
      400,
      'Feedback submission is only allowed within 15 days after the adhyayan ends'
    );
  }

  // Check if user has a confirmed booking for this adhyayan
  const booking = await ShibirBookingDb.findOne({
    where: {
      cardno,
      shibir_id: shibir_id,
      status: [STATUS_CONFIRMED, STATUS_CASH_COMPLETED]
    }
  });

  if (!booking) {
    throw new ApiError(403, ERR_FEEDBACK_NOT_ALLOWED);
  }

  const existingFeedback = await AdhyayanFeedback.findOne({
    where: {
      cardno: cardno,
      shibir_id: shibir_id
    }
  });

  if (existingFeedback) {
    throw new ApiError(400, ERR_FEEDBACK_ALREADY_SUBMITTED);
  }

  return { adhyayan, booking };
}

export async function getFeedbackStats(shibir_id) {
  const stats = await AdhyayanFeedback.findAll({
    where: { shibir_id },
    attributes: [
      [Sequelize.fn('COUNT', Sequelize.col('id')), 'total_responses'],
      [
        Sequelize.fn('AVG', Sequelize.col('swadhay_karta_rating')),
        'avg_swadhay_karta_rating'
      ],
      [
        Sequelize.fn('AVG', Sequelize.col('personal_interaction_rating')),
        'avg_personal_interaction_rating'
      ],
      [Sequelize.fn('AVG', Sequelize.col('food_rating')), 'avg_food_rating'],
      [Sequelize.fn('AVG', Sequelize.col('stay_rating')), 'avg_stay_rating'],
      [
        Sequelize.fn(
          'SUM',
          Sequelize.literal(
            'CASE WHEN raj_adhyayan_interest = 1 THEN 1 ELSE 0 END'
          )
        ),
        'interested_in_future'
      ]
    ],
    raw: true
  });

  return stats[0];
}

export async function createShibirAttendanceEntry(booking, user, transaction) {
  // Prevent duplicates (CRITICAL)
  const existing = await ShibirAttendanceDb.findOne({
    where: { bookingid: booking.bookingid },
    transaction
  });

  if (existing) return;

  const shibir = await ShibirDb.findOne({
    where: { id: booking.shibir_id },
    transaction
  });

  // Only Research Centre for now
  if (!shibir || shibir.location !== RESEARCH_CENTRE) return;

  const startDate = new Date(shibir.start_date);
  const endDate = new Date(shibir.end_date);

  const days = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

  //  Use integers for TINYINT
  const sessionFlags = {};
  for (let i = 1; i <= 9; i++) {
    sessionFlags[`session_${i}`] = 1;
  }

  await ShibirAttendanceDb.create(
    {
      shibir_id: booking.shibir_id,
      bookingid: booking.bookingid,
      cardno: booking.cardno,
      days,
      ...sessionFlags,
      updatedBy: user?.cardno || user?.username || 'system'
    },
    { transaction }
  );

  // Initialize dynamic sessions in shibir_sessions table if not already initialized
  const sessionsExist = await ShibirSession.findOne({
    where: { shibir_id: booking.shibir_id },
    transaction
  });

  if (!sessionsExist) {
    await initializeShibirSessions(shibir, transaction);
  }
}

export async function initializeShibirSessions(shibir, transaction) {
  const startDate = moment.tz(shibir.start_date, 'Asia/Kolkata').startOf('day');
  const endDate = moment.tz(shibir.end_date, 'Asia/Kolkata').startOf('day');
  const days = endDate.diff(startDate, 'days') + 1;

  const totalSessions = days * 3;
  const sessionsToCreate = [];

  // Generate regular sessions (1 to 2 * days)
  for (let d = 1; d <= days; d++) {
    const dateStr = moment.tz(shibir.start_date, 'Asia/Kolkata').add(d - 1, 'days').format('YYYY-MM-DD');

    // Session 1 of day d (Morning regular)
    sessionsToCreate.push({
      shibir_id: shibir.id,
      session_number: (d - 1) * 2 + 1,
      type: 'regular',
      date: dateStr,
      start_time: '10:00:00',
      updatedBy: 'system'
    });

    // Session 2 of day d (Afternoon regular)
    sessionsToCreate.push({
      shibir_id: shibir.id,
      session_number: (d - 1) * 2 + 2,
      type: 'regular',
      date: dateStr,
      start_time: '15:45:00',
      updatedBy: 'system'
    });
  }

  // Generate MV sessions (2 * days + 1 to 3 * days)
  for (let d = 1; d <= days; d++) {
    const dateStr = moment.tz(shibir.start_date, 'Asia/Kolkata').add(d - 1, 'days').format('YYYY-MM-DD');

    sessionsToCreate.push({
      shibir_id: shibir.id,
      session_number: 2 * days + d,
      type: 'MV',
      date: dateStr,
      start_time: '04:30:00',
      updatedBy: 'system'
    });
  }

  // Upsert all required sessions to ensure date/type changes are applied
  for (const session of sessionsToCreate) {
    await ShibirSession.upsert(session, { transaction });
  }

  // Delete any orphaned sessions and their attendance records if the duration decreased
  await ShibirSession.destroy({
    where: {
      shibir_id: shibir.id,
      session_number: { [Sequelize.Op.gt]: totalSessions }
    },
    transaction
  });

  await ShibirAttendanceRecord.destroy({
    where: {
      shibir_id: shibir.id,
      session_number: { [Sequelize.Op.gt]: totalSessions }
    },
    transaction
  });
}

export async function bookAdhyayanForMumukshusAdmin(
  shibir_ids,
  mumukshus,
  t,
  adminUser
) {
  // Same validations as user flow
  await validateCards(mumukshus);
  await checkAdhyayanAlreadyBooked(shibir_ids, mumukshus);

  const shibirs = await validateAdhyayans(shibir_ids);

  const result = await createAdhyayanBookingAdmin(
    shibirs,
    t,
    adminUser,
    ...mumukshus
  );

  return result;
}

export async function createAdhyayanBookingAdmin(
  adhyayans,
  t,
  adminUser,
  ...users
) {
  let amount = 0;
  let waitingBookingCount = 0;
  const userBookingIds = {};

  for (const booking_user of users) {
    const bookingIds = [];

    for (const adhyayan of adhyayans) {
      const bookingId = uuidv4();

      // Same locked decision as the user flow: the seat is taken (or not)
      // under a row lock, and that result — not a stale count — picks
      // confirmed vs waitlist.
      const seatReserved =
        adhyayan.status === STATUS_OPEN
          ? await reserveAdhyayanSeat(adhyayan, t)
          : false;

      if (seatReserved) {
        const status =
          adhyayan.amount > 0 ? STATUS_PAYMENT_PENDING : STATUS_CONFIRMED;

        const card = await CardDb.findOne({
          where: { cardno: booking_user }
        });

        if (!card) {
          throw new ApiError(400, `Card not found: ${booking_user}`);
        }

        // 🔹 bookedBy = admin (difference)
        const booking = await ShibirBookingDb.create(
          {
            bookingid: bookingId,
            cardno: booking_user,
            bookedBy: null,
            shibir_id: adhyayan.id,
            status,
            updatedBy: adminUser.username
          },
          { transaction: t }
        );

        // ✅ Attendance entry if confirmed or payment pending
        if (
          [STATUS_CONFIRMED, STATUS_PAYMENT_PENDING].includes(booking.status)
        ) {
          await createShibirAttendanceEntry(booking, adminUser, t);
        }

        // ✅ Pending transaction if payable
        if (adhyayan.amount > 0) {
          const { discountedAmount } = await createPendingTransaction(
            card,
            booking,
            TYPE_ADHYAYAN,
            adhyayan.amount,
            adminUser.username,
            t
          );
          amount += discountedAmount;
        }
      } else {
        // fallback WAITING (same as user flow)
        await ShibirBookingDb.create(
          {
            bookingid: bookingId,
            cardno: booking_user,
            bookedBy: null,
            shibir_id: adhyayan.id,
            status: STATUS_WAITING,
            updatedBy: adminUser.username || adminUser.cardno
          },
          { transaction: t }
        );

        waitingBookingCount++;
      }

      bookingIds.push(bookingId);
    }

    userBookingIds[booking_user] = bookingIds;
  }

  return { amount, userBookingIds, waitingBookingCount };
}

export async function resetShibirAttendance(bookingId, updatedBy, transaction) {
  await ShibirAttendanceDb.destroy({
    where: { bookingid: bookingId },
    transaction
  });

  await ShibirAttendanceRecord.destroy({
    where: { bookingid: bookingId },
    transaction
  });
}

export async function getPastAdhyayanAttendanceSummary({ startDate, endDate, location = RESEARCH_CENTRE }) {
  // 1. First fetch qualifying past Research Centre shibirs in date range
  const qualifyingShibirs = await database.query(
    `SELECT s.id
     FROM shibir_db s
     WHERE s.location = :location
       AND s.end_date <= CURRENT_DATE
       AND s.start_date >= :startDate
       AND s.start_date <= :endDate
       AND s.status != :statusDeleted
       AND (s.speaker IS NULL OR LOWER(TRIM(s.speaker)) NOT LIKE :excludedSpeakerPattern)
     ORDER BY s.start_date DESC`,
    {
      replacements: {
        location,
        startDate,
        endDate,
        statusDeleted: STATUS_DELETED,
        excludedSpeakerPattern: EXCLUDED_ATTENDANCE_SPEAKER_PATTERN
      },
      type: Sequelize.QueryTypes.SELECT
    }
  );

  if (qualifyingShibirs.length === 0) {
    return [];
  }

  const shibirIds = qualifyingShibirs.map((s) => s.id);

  const query = `
    SELECT 
      s.id AS shibir_id,
      s.name,
      s.speaker,
      s.location,
      DATE_FORMAT(s.start_date, '%Y-%m-%d') AS start_date,
      DATE_FORMAT(s.end_date, '%Y-%m-%d') AS end_date,
      DATEDIFF(s.end_date, s.start_date) + 1 AS no_of_days,
      CASE 
        WHEN COALESCE(cond.total_conducted, 0) > 0 THEN cond.total_conducted
        ELSE COALESCE(sess.total_configured, 0)
      END AS total_regular_sessions,
      COALESCE(part.total_registered, 0) AS total_registered,
      CASE 
        WHEN COALESCE(cond.total_conducted, 0) = 0 AND COALESCE(sess.total_configured, 0) = 0 THEN 0
        ELSE COALESCE(part.total_attended, 0)
      END AS total_attended,
      CASE 
        WHEN COALESCE(cond.total_conducted, 0) = 0 AND COALESCE(sess.total_configured, 0) = 0 THEN 0
        ELSE COALESCE(part.total_partial, 0)
      END AS total_partial,
      CASE 
        WHEN COALESCE(cond.total_conducted, 0) = 0 AND COALESCE(sess.total_configured, 0) = 0 THEN 0
        ELSE COALESCE(part.total_absent, 0)
      END AS total_absent,
      CASE 
        WHEN COALESCE(cond.total_conducted, 0) > 0 THEN 1 
        ELSE 0 
      END AS has_attendance_data
    FROM shibir_db s
    LEFT JOIN (
      SELECT shibir_id, COUNT(*) AS total_configured
      FROM shibir_sessions 
      WHERE type = 'regular' AND shibir_id IN (:shibirIds)
      GROUP BY shibir_id
    ) sess ON sess.shibir_id = s.id
    LEFT JOIN (
      SELECT ses.shibir_id, COUNT(DISTINCT r.session_number) AS total_conducted
      FROM shibir_attendance_records r
      JOIN shibir_sessions ses ON ses.shibir_id = r.shibir_id AND ses.session_number = r.session_number AND ses.type = 'regular'
      WHERE r.attended = 1 AND ses.shibir_id IN (:shibirIds)
      GROUP BY ses.shibir_id
    ) cond ON cond.shibir_id = s.id
    LEFT JOIN (
      SELECT 
        p.shibir_id,
        COUNT(*) AS total_registered,
        SUM(CASE WHEN p.attended_count = p.effective_sessions AND p.effective_sessions > 0 THEN 1 ELSE 0 END) AS total_attended,
        SUM(CASE WHEN p.attended_count > 0 AND p.attended_count < p.effective_sessions THEN 1 ELSE 0 END) AS total_partial,
        SUM(CASE WHEN p.attended_count = 0 THEN 1 ELSE 0 END) AS total_absent
      FROM (
        SELECT 
          b.shibir_id,
          b.bookingid,
          CASE 
            WHEN COALESCE(c_sub.total_conducted, 0) > 0 THEN c_sub.total_conducted
            ELSE COALESCE(ses_sub.total_configured, 0)
          END AS effective_sessions,
          COUNT(DISTINCT CASE WHEN r.attended = 1 THEN ses.session_number END) AS attended_count
        FROM shibir_booking_db b
        LEFT JOIN shibir_sessions ses ON ses.shibir_id = b.shibir_id AND ses.type = 'regular'
        LEFT JOIN (
          SELECT shibir_id, COUNT(*) AS total_configured
          FROM shibir_sessions 
          WHERE type = 'regular' AND shibir_id IN (:shibirIds)
          GROUP BY shibir_id
        ) ses_sub ON ses_sub.shibir_id = b.shibir_id
        LEFT JOIN (
          SELECT ses2.shibir_id, COUNT(DISTINCT r2.session_number) AS total_conducted
          FROM shibir_attendance_records r2
          JOIN shibir_sessions ses2 ON ses2.shibir_id = r2.shibir_id AND ses2.session_number = r2.session_number AND ses2.type = 'regular'
          WHERE r2.attended = 1 AND ses2.shibir_id IN (:shibirIds)
          GROUP BY ses2.shibir_id
        ) c_sub ON c_sub.shibir_id = b.shibir_id
        LEFT JOIN shibir_attendance_records r 
          ON r.bookingid = b.bookingid 
          AND r.session_number = ses.session_number
        WHERE b.shibir_id IN (:shibirIds) AND b.status = :statusConfirmed
        GROUP BY b.shibir_id, b.bookingid, c_sub.total_conducted, ses_sub.total_configured
      ) p
      GROUP BY p.shibir_id
    ) part ON part.shibir_id = s.id
    WHERE s.id IN (:shibirIds)
    ORDER BY s.start_date DESC;
  `;

  const results = await database.query(query, {
    replacements: {
      shibirIds,
      statusConfirmed: STATUS_CONFIRMED
    },
    type: Sequelize.QueryTypes.SELECT
  });

  return results.map((row) => ({
    shibir_id: Number(row.shibir_id),
    name: row.name,
    speaker: row.speaker,
    location: row.location,
    start_date: row.start_date,
    end_date: row.end_date,
    no_of_days: Number(row.no_of_days),
    total_regular_sessions: Number(row.total_regular_sessions),
    has_attendance_data: Boolean(Number(row.has_attendance_data)),
    total_registered: Number(row.total_registered),
    total_attended: Number(row.total_attended),
    total_partial: Number(row.total_partial),
    total_absent: Number(row.total_absent)
  }));
}

export async function getPastAdhyayanParticipantsByType({ shibirId, type }) {
  const shibir = await ShibirDb.findByPk(shibirId);
  if (!shibir) {
    throw new ApiError(404, 'Adhyayan not found');
  }

  if (shibir.speaker && shibir.speaker.toLowerCase().includes(EXCLUDED_ATTENDANCE_SPEAKER_SUBSTRING)) {
    throw new ApiError(400, 'Attendance report is not available for this speaker');
  }

  // Smart detection of effective regular sessions:
  // Count regular sessions that actually had attendance marked (r.attended = 1).
  // If no attendance records exist for any session, fall back to configured regular sessions count.
  const conductedSessionsResult = await database.query(
    `SELECT COUNT(DISTINCT r.session_number) AS total_conducted
     FROM shibir_attendance_records r
     JOIN shibir_sessions ses ON ses.shibir_id = r.shibir_id AND ses.session_number = r.session_number AND ses.type = 'regular'
     WHERE r.shibir_id = :shibirId AND r.attended = 1`,
    {
      replacements: { shibirId },
      type: Sequelize.QueryTypes.SELECT
    }
  );

  const conductedCount = Number(conductedSessionsResult[0]?.total_conducted || 0);
  const totalConfiguredSessions = await ShibirSession.count({
    where: { shibir_id: shibirId, type: 'regular' }
  });

  const effectiveRegularSessions = conductedCount > 0 ? conductedCount : totalConfiguredSessions;

  let whereTypeClause = '';
  if (type === 'attended') {
    if (effectiveRegularSessions === 0) {
      return { shibir, totalRegularSessions: 0, regularSessions: [], participants: [] };
    }
    whereTypeClause = 'AND p.attended_regular_sessions = :effectiveRegularSessions AND :effectiveRegularSessions > 0';
  } else if (type === 'partial') {
    if (effectiveRegularSessions === 0) {
      return { shibir, totalRegularSessions: 0, regularSessions: [], participants: [] };
    }
    whereTypeClause = 'AND p.attended_regular_sessions > 0 AND p.attended_regular_sessions < :effectiveRegularSessions';
  } else if (type === 'absent') {
    if (effectiveRegularSessions === 0) {
      return { shibir, totalRegularSessions: 0, regularSessions: [], participants: [] };
    }
    whereTypeClause = 'AND p.attended_regular_sessions = 0';
  } else if (type === 'registered' || type === 'complete') {
    whereTypeClause = '';
  } else {
    throw new ApiError(400, "Invalid type. Must be one of: 'registered', 'attended', 'partial', 'absent', 'complete'");
  }

  const query = `
    SELECT 
      b.cardno,
      c.issuedto AS name,
      c.mobno,
      c.center,
      c.gender,
      c.res_status,
      p.attended_regular_sessions,
      p.attended_session_numbers,
      :effectiveRegularSessions AS total_regular_sessions,
      CASE 
        WHEN :effectiveRegularSessions = 0 THEN 'N/A'
        ELSE CONCAT(p.attended_regular_sessions, ' of ', :effectiveRegularSessions, ' sessions')
      END AS attendance_summary
    FROM (
      SELECT 
        b.bookingid,
        b.cardno,
        COUNT(DISTINCT CASE WHEN r.attended = 1 THEN ses.session_number END) AS attended_regular_sessions,
        GROUP_CONCAT(DISTINCT CASE WHEN r.attended = 1 THEN ses.session_number END ORDER BY ses.session_number) AS attended_session_numbers
      FROM shibir_booking_db b
      LEFT JOIN shibir_sessions ses ON ses.shibir_id = b.shibir_id AND ses.type = 'regular'
      LEFT JOIN shibir_attendance_records r 
        ON r.bookingid = b.bookingid 
        AND r.session_number = ses.session_number
      WHERE b.shibir_id = :shibirId AND b.status = :statusConfirmed
      GROUP BY b.bookingid, b.cardno
    ) p
    JOIN shibir_booking_db b ON b.bookingid = p.bookingid
    LEFT JOIN card_db c ON c.cardno = b.cardno
    WHERE 1=1 ${whereTypeClause}
    ORDER BY c.issuedto ASC, b.cardno ASC;
  `;

  const participants = await database.query(query, {
    replacements: {
      shibirId,
      statusConfirmed: STATUS_CONFIRMED,
      effectiveRegularSessions
    },
    type: Sequelize.QueryTypes.SELECT
  });

  let regularSessions;
  if (conductedCount > 0) {
    regularSessions = await database.query(
      `SELECT DISTINCT ses.session_number, ses.date, ses.start_time
       FROM shibir_sessions ses
       JOIN shibir_attendance_records r 
         ON r.shibir_id = ses.shibir_id 
        AND r.session_number = ses.session_number 
        AND ses.type = 'regular'
       WHERE ses.shibir_id = :shibirId AND r.attended = 1
       ORDER BY ses.session_number ASC`,
      {
        replacements: { shibirId },
        type: Sequelize.QueryTypes.SELECT
      }
    );
  } else {
    regularSessions = await ShibirSession.findAll({
      where: { shibir_id: shibirId, type: 'regular' },
      order: [['session_number', 'ASC']]
    });
  }

  return {
    shibir: {
      id: shibir.id,
      name: shibir.name,
      speaker: shibir.speaker,
      location: shibir.location,
      start_date: shibir.start_date,
      end_date: shibir.end_date,
      total_regular_sessions: effectiveRegularSessions
    },
    totalRegularSessions: effectiveRegularSessions,
    regularSessions: regularSessions.map((s) => ({
      session_number: Number(s.session_number),
      date: s.date,
      start_time: s.start_time
    })),
    participants: participants.map((p) => {
      const attended = Number(p.attended_regular_sessions);
      const total = effectiveRegularSessions;
      let category = 'Absent';
      if (total > 0) {
        if (attended === total) {
          category = 'Full Attended';
        } else if (attended > 0) {
          category = 'Partially Attended';
        } else {
          category = 'Absent';
        }
      } else {
        category = 'Registered';
      }

      return {
        cardno: p.cardno,
        name: p.name || '',
        mobno: p.mobno || '',
        center: p.center || '',
        gender: p.gender || '',
        res_status: p.res_status || '',
        attended_regular_sessions: attended,
        total_regular_sessions: total,
        attended_session_numbers: p.attended_session_numbers
          ? p.attended_session_numbers.split(',').map(Number)
          : [],
        category,
        attendance_summary: p.attendance_summary
      };
    })
  };
}

export async function getShibirRegularSessionsManagement({ shibirId }) {
  const shibir = await ShibirDb.findByPk(shibirId);
  if (!shibir) {
    throw new ApiError(404, 'Adhyayan not found');
  }

  const sessions = await ShibirSession.findAll({
    where: { shibir_id: shibirId, type: 'regular' },
    order: [['session_number', 'ASC']]
  });

  const attendanceCounts = await database.query(
    `SELECT session_number, COUNT(*) AS count
     FROM shibir_attendance_records
     WHERE shibir_id = :shibirId AND attended = 1
     GROUP BY session_number`,
    {
      replacements: { shibirId },
      type: Sequelize.QueryTypes.SELECT
    }
  );

  const countMap = {};
  attendanceCounts.forEach((r) => {
    countMap[r.session_number] = Number(r.count);
  });

  const sessionDetails = sessions.map((s) => {
    const attendees = countMap[s.session_number] || 0;
    return {
      id: s.id,
      session_number: s.session_number,
      date: s.date,
      start_time: s.start_time,
      attendance_count: attendees,
      can_remove: attendees === 0
    };
  });

  return {
    shibir: {
      id: shibir.id,
      name: shibir.name,
      speaker: shibir.speaker,
      start_date: shibir.start_date,
      end_date: shibir.end_date
    },
    total_sessions: sessions.length,
    sessions: sessionDetails
  };
}

export async function removeUnusedShibirSession({ shibirId, sessionNumber, adminUsername, log = logger, transaction }) {
  const session = await ShibirSession.findOne({
    where: {
      shibir_id: shibirId,
      session_number: sessionNumber,
      type: 'regular'
    },
    transaction
  });

  if (!session) {
    throw new ApiError(404, `Regular session ${sessionNumber} not found for this Adhyayan`);
  }

  // Safety check: ensure no marked attendance exists
  const attendanceCount = await ShibirAttendanceRecord.count({
    where: {
      shibir_id: shibirId,
      session_number: sessionNumber,
      attended: 1
    },
    transaction
  });

  if (attendanceCount > 0) {
    log.warn('attempted_remove_session_with_attendance', {
      shibirId,
      sessionNumber,
      attendanceCount,
      adminUsername
    });
    throw new ApiError(
      400,
      `Cannot remove Session ${sessionNumber}: ${attendanceCount} participant(s) already have attendance marked for this session.`
    );
  }

  // Remove any empty attendance record entries for this session
  await ShibirAttendanceRecord.destroy({
    where: {
      shibir_id: shibirId,
      session_number: sessionNumber
    },
    transaction
  });

  // Delete the regular session
  await session.destroy({ transaction });

  log.info('shibir_regular_session_removed', {
    shibirId,
    sessionNumber,
    adminUsername
  });

  return { success: true, message: `Session ${sessionNumber} removed successfully.` };
}

export async function restoreDefaultShibirSessions({ shibirId, adminUsername, log = logger, transaction }) {
  const shibir = await ShibirDb.findByPk(shibirId, { transaction });
  if (!shibir) {
    throw new ApiError(404, 'Adhyayan not found');
  }

  await initializeShibirSessions(shibir, transaction);

  log.info('shibir_default_sessions_restored', {
    shibirId,
    adminUsername
  });

  return { success: true, message: 'Default sessions restored successfully.' };
}

export async function getAllPastAdhyayanAbsentees({ startDate, endDate, location = RESEARCH_CENTRE }) {
  const query = `
    SELECT 
      s.id AS shibir_id,
      s.name AS shibir_name,
      s.speaker,
      DATE_FORMAT(s.start_date, '%Y-%m-%d') AS start_date,
      DATE_FORMAT(s.end_date, '%Y-%m-%d') AS end_date,
      DATEDIFF(s.end_date, s.start_date) + 1 AS no_of_days,
      b.cardno,
      COALESCE(c.issuedto, '') AS name,
      COALESCE(c.mobno, '') AS mobno,
      COALESCE(c.center, '') AS center,
      COALESCE(c.gender, '') AS gender,
      COALESCE(c.res_status, '') AS res_status
    FROM shibir_db s
    JOIN shibir_booking_db b ON b.shibir_id = s.id AND b.status = :statusConfirmed
    LEFT JOIN card_db c ON c.cardno = b.cardno
    LEFT JOIN (
      SELECT r.bookingid, COUNT(DISTINCT r.session_number) AS attended_count
      FROM shibir_attendance_records r
      JOIN shibir_sessions ses ON ses.shibir_id = r.shibir_id AND ses.session_number = r.session_number AND ses.type = 'regular'
      WHERE r.attended = 1
      GROUP BY r.bookingid
    ) att ON att.bookingid = b.bookingid
    WHERE s.location = :location
      AND s.end_date <= CURRENT_DATE
      AND s.start_date >= :startDate
      AND s.start_date <= :endDate
      AND s.status != :statusDeleted
      AND (s.speaker IS NULL OR LOWER(TRIM(s.speaker)) NOT LIKE :excludedSpeakerPattern)
      AND COALESCE(att.attended_count, 0) = 0
      AND EXISTS (
        SELECT 1
        FROM shibir_attendance_records r3
        JOIN shibir_sessions ses3 ON ses3.shibir_id = r3.shibir_id AND ses3.session_number = r3.session_number AND ses3.type = 'regular'
        WHERE r3.shibir_id = s.id AND r3.attended = 1
      )
    ORDER BY s.start_date DESC, c.issuedto ASC, b.cardno ASC;
  `;

  const absentees = await database.query(query, {
    replacements: {
      location,
      startDate,
      endDate,
      statusConfirmed: STATUS_CONFIRMED,
      statusDeleted: STATUS_DELETED,
      excludedSpeakerPattern: EXCLUDED_ATTENDANCE_SPEAKER_PATTERN
    },
    type: Sequelize.QueryTypes.SELECT
  });

  return absentees.map((r) => ({
    shibir_id: Number(r.shibir_id),
    shibir_name: r.shibir_name,
    speaker: r.speaker,
    start_date: r.start_date,
    end_date: r.end_date,
    no_of_days: Number(r.no_of_days),
    cardno: r.cardno,
    name: r.name,
    mobno: r.mobno ? String(r.mobno) : '',
    center: r.center,
    gender: r.gender,
    res_status: r.res_status
  }));
}
