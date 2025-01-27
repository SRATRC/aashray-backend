import { 
  ERR_ADHYAYAN_ALREADY_BOOKED,
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
} from '../models/associations.js'
import { v4 as uuidv4 } from 'uuid';
import ApiError from '../utils/ApiError.js';

export async function checkAdhyayanAlreadyBooked(shibirIds, ...mumukshus) {
  const booking = await ShibirBookingDb.findOne({
    where: {
      shibir_id: shibirIds,
      cardno: mumukshus,
      guest: null,
      status: [
        STATUS_CONFIRMED,
        STATUS_WAITING,
        STATUS_PAYMENT_PENDING
      ]
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
  shibirs, 
  transaction_type, 
  upi_ref, 
  t, 
  ...mumukshus
) {
  var bookings = [];
  var transactions = [];

  for (const mumukshu of mumukshus) {
    for (const shibir of shibirs) {
      const bookingId = uuidv4();

      const status = STATUS_WAITING;

      // TODO: Apply Discounts on credits left
      if (shibir.dataValues.available_seats > 0) {

        status = STATUS_PAYMENT_PENDING;

        shibir.available_seats -= 1;
        await shibir.save({ transaction: t });



        transactions.push({
          cardno: mumukshu,
          bookingid: bookingId,
          category: TYPE_ADHYAYAN,
          amount: shibir.dataValues.amount,
          status: STATUS_PAYMENT_PENDING
        });
      }

      bookings.push({
        cardno: mumukshu,
        bookingid: bookingId,
        shibir_id: shibir.dataValues.id,
        status: status
      });        
    }
  }

  await ShibirBookingDb.bulkCreate(bookings, { transaction: t });
  await Transactions.bulkCreate(transactions, { transaction: t });

  return t;
}

export async function reserveAdhyayanSeat(adhyayan, t) {
  if (adhyayan.dataValues.available_seats > 0) {
    await adhyayan.update(
      {
        available_seats: adhyayan.dataValues.available_seats - 1
      },
      { transaction: t }
    );
  }
}

export async function unreserveAdhyayanSeat(adhyayan, t) {
  if (adhyayan.dataValues.available_seats > 0) {
    await adhyayan.update(
      {
        available_seats: adhyayan.dataValues.available_seats + 1
      },
      { transaction: t }
    );
  }
}