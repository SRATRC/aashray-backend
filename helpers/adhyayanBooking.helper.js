import {
  ERR_ADHYAYAN_ALREADY_BOOKED,
  ERR_ADHYAYAN_NO_SEATS_AVAILABLE,
  ERR_ADHYAYAN_NOT_FOUND,
  ERR_BOOKING_NOT_FOUND,
  STATUS_CONFIRMED,
  STATUS_PAYMENT_PENDING,
  STATUS_WAITING,
  TYPE_ADHYAYAN
} from '../config/constants.js';
import { ShibirBookingDb, ShibirDb } from '../models/associations.js';
import { v4 as uuidv4 } from 'uuid';
import ApiError from '../utils/ApiError.js';
import { createPendingTransaction, useCredit } from './transactions.helper.js';
import { validateCards } from './card.helper.js';

export async function bookAdhyayanForMumukshus(shibir_ids, mumukshus, t, user) {
  await validateCards(mumukshus);
  await checkAdhyayanAlreadyBooked(shibir_ids, mumukshus);
  const shibirs = await validateAdhyayans(shibir_ids);

  const result = await createAdhyayanBooking(shibirs, t, user,...mumukshus);

  return result;
}

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
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  return booking;
}

export async function createAdhyayanBooking(adhyayans, t, user, ...mumukshus) {
  let amount = 0,bookingIds=[],idx=0,bookingId;
  for (const mumukshu of mumukshus) {
    for (const adhyayan of adhyayans) {
      if (adhyayan.available_seats > 0) {
        await reserveAdhyayanSeat(adhyayan, t);
        bookingId = uuidv4();
        const booking = await ShibirBookingDb.create(
          {
            bookingid: bookingId,
            cardno: mumukshu,
            shibir_id: adhyayan.id,
            status: STATUS_PAYMENT_PENDING
          },
          { transaction: t }
        );
        bookingIds[idx++] = bookingId;

        const { transaction, discountedAmount } = await createPendingTransaction(
          mumukshu,
          booking,
          TYPE_ADHYAYAN,
          adhyayan.amount,
          user.cardno,
          t
        );

        amount += discountedAmount;
      } else {
        bookingId = uuidv4();
        const booking =  await ShibirBookingDb.create(
          {
            bookingid:bookingId,
            cardno: mumukshu,
            shibir_id: adhyayan.id,
            status: STATUS_WAITING
          },
          { transaction: t }
        );
        bookingIds[idx++] = bookingId;
      }
    }
  }
  
  return { t, amount,bookingIds };
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
    var available = mumukshus.length;
    var waiting = 0;
    var charge = 0;

    if (shibir.dataValues.available_seats < mumukshus.length) {
      available = shibir.dataValues.available_seats;
      waiting = mumukshus.length - shibir.dataValues.available_seats;
    }
    charge = available * shibir.dataValues.amount;

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
        attributes: ['name','speaker','month','start_date','end_date'],
        where: { id: Sequelize.col('ShibirBookingDb.shibir_id') }
      }
    ],
    where: {
      [Op.in]:bookingIds
    }
    
  });

  return adhyanBookings;
}