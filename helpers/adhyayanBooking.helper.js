import {
  ERR_ADHYAYAN_ALREADY_BOOKED,
  ERR_ADHYAYAN_NO_SEATS_AVAILABLE,
  ERR_ADHYAYAN_NOT_FOUND,
  ERR_BOOKING_NOT_FOUND,
  STATUS_CONFIRMED,
  STATUS_OPEN,
  STATUS_PAYMENT_PENDING,
  STATUS_WAITING,
  TYPE_ADHYAYAN
} from '../config/constants.js';
import { ShibirBookingDb, ShibirDb, UtsavDb } from '../models/associations.js';
import { v4 as uuidv4 } from 'uuid';
import { createPendingTransaction } from './transactions.helper.js';
import { validateCard, validateCards } from './card.helper.js';
import ApiError from '../utils/ApiError.js';
import moment from 'moment';
import Sequelize from 'sequelize';

export async function bookAdhyayanForMumukshus(shibir_ids, mumukshus, t, user) {
  await validateCards(mumukshus);
  await checkAdhyayanAlreadyBooked(shibir_ids, mumukshus);
  const shibirs = await validateAdhyayans(shibir_ids);

  const result = await createAdhyayanBooking(shibirs, t, user, ...mumukshus);

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

  const utsav = await UtsavDb.findOne({
    where: {
      [Sequelize.Op.or]: [
        { start_date: date },
        { end_date: date },
        Sequelize.literal(`DATE_ADD(start_date, INTERVAL -1 DAY) = '${date}'`),
        Sequelize.literal(`DATE_ADD(end_date, INTERVAL 1 DAY) = '${date}'`)
      ]
    }
  });

  if (utsav) {
    return true;
  }

  return false;
}

export async function validateAdhyayans(...shibirIds) {
  const shibirs = await ShibirDb.findAll({
    where: {
      id: shibirIds,
      start_date: { [Sequelize.Op.gte]: moment().format('YYYY-MM-DD') }
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
  let amount = 0,
    waitingBookingCount = 0;
  const userBookingIds = {};

  for (const booking_user of users) {
    const bookingIds = [];
    for (const adhyayan of adhyayans) {
      const bookingId = uuidv4();
      if (adhyayan.available_seats > 0 && adhyayan.status == STATUS_OPEN) {
        await reserveAdhyayanSeat(adhyayan, t);

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
            shibir_id: adhyayan.id,
            status: STATUS_WAITING
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

export async function reserveAdhyayanSeat(adhyayan, t) {
  if (adhyayan.available_seats <= 0) {
    throw new ApiError(400, ERR_ADHYAYAN_NO_SEATS_AVAILABLE);
  }

  await adhyayan.update(
    {
      available_seats: adhyayan.dataValues.available_seats - 1
    },
    { transaction: t }
  );
}

export async function openAdhyayanSeat(adhyayan, updatedBy, t) {
  const booking = await ShibirBookingDb.findOne({
    where: {
      shibir_id: adhyayan.id,
      status: STATUS_WAITING
    },
    order: [['createdAt', 'ASC']]
  });

  if (booking) {
    await booking.update(
      {
        status: STATUS_PAYMENT_PENDING
      },
      { transaction: t }
    );

    // for a booking in waiting status, there should be no existing transaction
    const bookedBy = booking.bookedBy || booking.cardno;
    const card = await validateCard(bookedBy);
    const transaction = await createPendingTransaction(
      card,
      booking,
      TYPE_ADHYAYAN,
      adhyayan.amount,
      updatedBy,
      t
    );

    // TODO: send notification and email to user
  } else {
    await adhyayan.update(
      {
        available_seats: adhyayan.dataValues.available_seats + 1
      },
      { transaction: t }
    );
  }
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
