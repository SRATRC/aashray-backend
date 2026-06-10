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
  RESEARCH_CENTRE
} from '../config/constants.js';
import {
  AdhyayanFeedback,
  ShibirBookingDb,
  ShibirDb,
  UtsavPackagesDb,
  CardDb,
  ShibirAttendanceDb
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
  const sevenDaysAgo = moment().subtract(15, 'days').format('YYYY-MM-DD');

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
      if (adhyayan.available_seats > 0 && adhyayan.status == STATUS_OPEN) {
        await reserveAdhyayanSeat(adhyayan, t, log);

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

export async function reserveAdhyayanSeat(adhyayan, t, log = logger) {
  if (adhyayan.available_seats <= 0) {
    throw new ApiError(400, ERR_ADHYAYAN_NO_SEATS_AVAILABLE);
  }

  await adhyayan.update(
    {
      available_seats: adhyayan.dataValues.available_seats - 1
    },
    { transaction: t }
  );
  log.debug('adhyayan_seat_decremented', {
    shibir_id: adhyayan.id,
    remaining: adhyayan.dataValues.available_seats - 1
  });
}

export async function openAdhyayanSeat(adhyayan, updatedBy, t, log = logger) {
  const booking = await ShibirBookingDb.findOne({
    include: [
      {
        model: CardDb,
        attributes: ['token', 'issuedto']
      }
    ],
    where: {
      shibir_id: adhyayan.id,
      status: STATUS_WAITING
    },
    order: [['createdAt', 'ASC']]
  });

  if (booking) {
    // Preserve booker attribution on promotion: keep the original bookedBy
    // (already set at creation) and record who triggered the promotion.
    await booking.update(
      {
        status: STATUS_PAYMENT_PENDING,
        bookedBy: booking.bookedBy,
        updatedBy
      },
      { transaction: t }
    );

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
    log.info('adhyayan_waitlist_promoted', {
      bookingid: booking.bookingid,
      cardno: booking.cardno,
      shibir_id: adhyayan.id
    });
    return booking;
  } else {
    await adhyayan.update(
      {
        available_seats: adhyayan.dataValues.available_seats + 1
      },
      { transaction: t }
    );
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

export async function getAdhyayanBookings(bookingIds) {
  const adhyanBookings = await ShibirBookingDb.findOne({
    include: [
      {
        model: ShibirDb,
        attributes: ['name', 'speaker', 'month', 'start_date', 'end_date'],
        where: { id: Sequelize.col('ShibirBookingDb.shibir_id') }
      }
    ],
    where: {
      [Op.in]: bookingIds
    }
  });

  return adhyanBookings;
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
  // 🔒 Prevent duplicates (CRITICAL)
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

  // ✅ Use integers for TINYINT
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

      if (adhyayan.available_seats > 0 && adhyayan.status === STATUS_OPEN) {
        // ✅ Seat reservation
        await reserveAdhyayanSeat(adhyayan, t);

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

        // ✅ Attendance entry if confirmed
        if (booking.status === STATUS_CONFIRMED) {
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
  await ShibirAttendanceDb.update(
    {
      session_1: 0,
      session_2: 0,
      session_3: 0,
      session_4: 0,
      session_5: 0,
      session_6: 0,
      session_7: 0,
      session_8: 0,
      session_9: 0,
      updatedBy
    },
    {
      where: { bookingid: bookingId },
      transaction
    }
  );
}
