import {
  ERR_ADHYAYAN_ALREADY_BOOKED,
  ERR_ADHYAYAN_NO_SEATS_AVAILABLE,
  ERR_ADHYAYAN_NOT_FOUND,
  ERR_BOOKING_NOT_FOUND,
  ERR_TRANSACTION_NOT_FOUND,
  STATUS_CASH_COMPLETED,
  STATUS_CONFIRMED,
  STATUS_PAYMENT_COMPLETED,
  STATUS_PAYMENT_PENDING,
  STATUS_WAITING,
  TRANSACTION_TYPE_CASH,
  TRANSACTION_TYPE_UPI,
  TYPE_ADHYAYAN
} from '../config/constants.js';
import {
  ShibirBookingDb,
  ShibirDb,
  Transactions
} from '../models/associations.js';
import { v4 as uuidv4 } from 'uuid';
import ApiError from '../utils/ApiError.js';
import { createPendingTransaction, useCredit } from './transactions.helper.js';

export async function checkAdhyayanAlreadyBooked(shibirIds, ...mumukshus) {
  const booking = await ShibirBookingDb.findOne({
    where: {
      shibir_id: shibirIds,
      cardno: mumukshus,
      guest: null,
      status: [STATUS_CONFIRMED, STATUS_WAITING, STATUS_PAYMENT_PENDING]
    }
  });

  if (booking) {
    throw new ApiError(400, ERR_ADHYAYAN_ALREADY_BOOKED);
  }
}

export async function validateAdhyayans(...shibirIds) {
  const shibirs = await ShibirDb.findAll({
    where: { id: shibirIds }
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
    throw new ApiError(400, ERR_BOOKING_NOT_FOUND);
  }

  return booking;
}

export async function createAdhyayanBooking(
  adhyayans,
  transaction_type,
  upi_ref,
  t,
  ...mumukshus
) {
  var bookings = [];
  var transactions = [];

  for (const mumukshu of mumukshus) {
    for (const adhyayan of adhyayans) {

      if (adhyayan.available_seats > 0) {

        await reserveAdhyayanSeat(adhyayan, t);

        const booking = await ShibirBookingDb.create(
          {
            bookingid: uuidv4(),
            cardno: mumukshu,
            shibir_id: adhyayan.id,
            status: STATUS_PAYMENT_PENDING
          },
          { transaction: t }
        );

        const transaction = await createPendingTransaction(
          mumukshu,
          booking.bookingid,
          TYPE_ADHYAYAN,
          adhyayan.amount,
          'USER',
          t
        );

        await useCredit(
          mumukshu,
          booking,
          transaction,
          adhyayan.amount,
          'USER',
          t
        );
      } else {
        await ShibirBookingDb.create(
          {
            bookingid: uuidv4(),
            cardno: mumukshu,
            shibir_id: adhyayan.id,
            status: STATUS_WAITING
          },
          { transaction: t }
        );
      }
    }
  }

  return t;
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

export async function openAdhyayanSeat(adhyayan, cardno, updatedBy, t) {
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
    const transaction = await createPendingTransaction(
      cardno,
      booking.bookingid,
      TYPE_ADHYAYAN,
      adhyayan.amount,
      updatedBy,
      t
    );

    await useCredit(
      cardno,
      booking,
      transaction,
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
