import { 
  ERR_ADHYAYAN_ALREADY_BOOKED,
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

export async function validateAdhyayans(shibirIds) {
  const shibirs = await ShibirDb.findAll({
    where: { id: shibirIds } 
  });

  if (shibirs.length != shibirIds.length) {
    throw new ApiError(400, ERR_ADHYAYAN_NOT_FOUND);
  }

  return shibirs;
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

      if (shibir.dataValues.available_seats > 0) {
        bookings.push({
          bookingid: bookingId,
          shibir_id: shibir.dataValues.id,
          cardno: mumukshu,
          status:
            transaction_type == TRANSACTION_TYPE_UPI
              ? STATUS_CONFIRMED
              : STATUS_PAYMENT_PENDING
        });

        shibir.available_seats -= 1;
        await shibir.save({ transaction: t });

        // TODO: Apply Discounts on credits left
        // TODO: transaction status should be pending and updated to completed only after payment
        transactions.push({
          cardno: mumukshu,
          bookingid: bookingId,
          category: TYPE_ADHYAYAN,
          amount: shibir.dataValues.amount,
          upi_ref: upi_ref,
          status:
            transaction_type == TRANSACTION_TYPE_UPI
              ? STATUS_PAYMENT_COMPLETED
              : transaction_type == TRANSACTION_TYPE_CASH
              ? STATUS_CASH_COMPLETED
              : null,
          updatedBy: 'USER'
        });
      } else {
        bookings.push({
          bookingid: bookingId,
          shibir_id: shibir.dataValues.id,
          cardno: mumukshu,
          status: STATUS_WAITING
        });
      }
    }
  }

  await ShibirBookingDb.bulkCreate(bookings, { transaction: t });
  await Transactions.bulkCreate(transactions, { transaction: t });

  return t;
}