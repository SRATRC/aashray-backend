import {
  ERR_INVALID_DATE,
  ERR_TRAVEL_ALREADY_BOOKED,
  RAJ_PRAVAS_EMAIL,
  STATUS_ADMIN_CANCELLED,
  STATUS_AWAITING_CONFIRMATION,
  STATUS_CANCELLED,
  STATUS_CONFIRMED,
  STATUS_PAYMENT_PENDING,
  STATUS_WAITING,
  TRAVEL_TYPE_REGULAR
} from '../config/constants.js';
import { CardDb, TravelDb } from '../models/associations.js';
import { validateCards } from './card.helper.js';
import { checkAdhyayanParamGyanSabhaOrUtsav } from './adhyayanBooking.helper.js';
import { v4 as uuidv4 } from 'uuid';
import ApiError from '../utils/ApiError.js';
import moment from 'moment';
import Sequelize from 'sequelize';
import sendMail from '../utils/sendMail.js';

export async function checkTravelAlreadyBooked(date, ...mumukshus) {
  const booking = await TravelDb.findOne({
    where: {
      cardno: mumukshus,
      status: [STATUS_CONFIRMED, STATUS_WAITING, STATUS_PAYMENT_PENDING],
      date: date
    }
  });

  if (booking) {
    throw new ApiError(400, ERR_TRAVEL_ALREADY_BOOKED);
  }
}

async function getTravelBookingStatus(type, date, travelBookingsFordate) {
  //if regular travel and more than 5 bookings for the date, then waiting.
  // But if it is a gyan sabha or utsav, then return awaiting confirmation.
  if (type == TRAVEL_TYPE_REGULAR && travelBookingsFordate > 4) {
    if (await checkAdhyayanParamGyanSabhaOrUtsav(date)) {
      return STATUS_AWAITING_CONFIRMATION;
    }
    return STATUS_WAITING;
  } else {
    return STATUS_AWAITING_CONFIRMATION;
  }
}

export async function updateWaitingTravelBooking(date) {
  const travelBookingsFordate = await TravelDb.findOne({
    where: {
      date: date,
      status: STATUS_WAITING
    },
    order: [['createdAt', 'ASC']]
  });

  if (travelBookingsFordate) {
    await TravelDb.update(
      {
        status: STATUS_AWAITING_CONFIRMATION
      },
      {
        where: {
          bookingid: travelBookingsFordate.bookingid
        }
      }
    );
    const user = await CardDb.findOne({
      where: {
        cardno: travelBookingsFordate.cardno
      }
    });

    sendMail({
      email: user.email,
      subject: 'Vitraag Vigyaan Aashray: Raj Pravas - Travel Booking Updated',
      template: 'rajPravasStatusUpdate',
      context: {
        name: user.issuedto,
        bookingid: travelBookingsFordate.bookingid,
        date: moment(travelBookingsFordate.date).format('Do MMMM, YYYY'),
        pickup: travelBookingsFordate.pickup_point,
        drop: travelBookingsFordate.drop_point,
        status: STATUS_AWAITING_CONFIRMATION
      }
    });
  }
}

export async function bookTravelForMumukshus(date, mumukshuGroup, t, user) {
  const today = moment().format('YYYY-MM-DD');
  if (date < today) {
    throw new ApiError(400, ERR_INVALID_DATE);
  }
  let userBookingIds = {},
    waitingBookingCount = 0;
  const mumukshus = mumukshuGroup.flatMap((group) => group.mumukshus);
  await validateCards(mumukshus);
  await checkTravelAlreadyBooked(date, mumukshus);

  const bookings = await TravelDb.findAll({
    where: {
      type: TRAVEL_TYPE_REGULAR,
      status: {
        [Sequelize.Op.notIn]: [STATUS_ADMIN_CANCELLED, STATUS_CANCELLED]
      },
      date: date
    }
  });
  let travelBookingsFordate = bookings.length;
  var bookingsToCreate = [],
    bookingId;
  for (const group of mumukshuGroup) {
    const {
      pickup_point,
      drop_point,
      luggage,
      comments,
      type,
      mumukshus,
      arrival_time,
      leaving_post_adhyayan,
      total_people = 1
    } = group;

    for (const mumukshu of mumukshus) {
      bookingId = uuidv4();
      let travelbookingStatus = await getTravelBookingStatus(
        type,
        date,
        travelBookingsFordate
      );
      if (travelbookingStatus == STATUS_WAITING) {
        waitingBookingCount++;
      }
      bookingsToCreate.push({
        bookingid: bookingId,
        cardno: mumukshu,
        bookedBy: user.cardno !== mumukshu ? user.cardno : null,
        status: travelbookingStatus,
        date,
        type,
        pickup_point,
        drop_point,
        luggage,
        arrival_time,
        leaving_post_adhyayan,
        total_people,
        comments,
        updatedBy: user.cardno
      });
      travelBookingsFordate++;
      userBookingIds[mumukshu] = [bookingId];
    }
  }
  await TravelDb.bulkCreate(bookingsToCreate, { transaction: t });
  return { userBookingIds, waitingBookingCount };
}
