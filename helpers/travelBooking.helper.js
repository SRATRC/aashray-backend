import {
  ERR_INVALID_DATE,
  ERR_TRAVEL_ALREADY_BOOKED,
  RESEARCH_CENTRE,
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
import { createPendingTransaction } from './transactions.helper.js';

export async function checkTravelAlreadyBooked(
  date,
  { mumukshus, drop_point }
) {
  const isToResearchCentre = drop_point === RESEARCH_CENTRE;

  // Check for existing booking in the same direction
  const booking = await TravelDb.findOne({
    where: {
      cardno: mumukshus,
      status: [
        STATUS_CONFIRMED,
        STATUS_WAITING,
        STATUS_PAYMENT_PENDING,
        STATUS_AWAITING_CONFIRMATION
      ],
      date: date,
      pickup_point: isToResearchCentre
        ? { [Sequelize.Op.ne]: RESEARCH_CENTRE }
        : RESEARCH_CENTRE,
      drop_point: isToResearchCentre
        ? RESEARCH_CENTRE
        : { [Sequelize.Op.ne]: RESEARCH_CENTRE }
    }
  });

  if (booking) {
    throw new ApiError(
      400,
      'Travel already booked for this direction on the selected date'
    );
  }
}

async function getTravelBookingStatus(type, date, travelBookingsFordate) {
  //if regular travel and more than 5 bookings for the date, then waiting.
  // But if it is a gyan sabha or utsav, then return awaiting confirmation.
  if (type!= null && type.toLowerCase() == TRAVEL_TYPE_REGULAR.toLowerCase() && travelBookingsFordate > 4) {
    if (!await checkAdhyayanParamGyanSabhaOrUtsav(date)){
      return STATUS_WAITING;
    }
  }

  return STATUS_AWAITING_CONFIRMATION;
}

export async function updateWaitingTravelBooking(booking, t) {
  const { date, drop_point, pickup_point } = booking;

  const conditions = [];
  conditions.push({
    status: STATUS_WAITING
  });
  conditions.push({
    date: date
  });
  if(drop_point === RESEARCH_CENTRE) {
    conditions.push({
      drop_point: {
        [Sequelize.Op.eq]: RESEARCH_CENTRE
      }
    });
  }
  if(pickup_point === RESEARCH_CENTRE) {
    conditions.push({
      pickup_point: {
        [Sequelize.Op.eq]: RESEARCH_CENTRE
      }
    });
  }
  const travelBookingsFordate = await TravelDb.findOne({
    where: conditions,
    order: [['createdAt', 'ASC']]
  });
  if (travelBookingsFordate) {
    await travelBookingsFordate.update(
      {
        status: STATUS_AWAITING_CONFIRMATION
      },
      { transaction: t }
    );
    
    return travelBookingsFordate;
    
  }
}

export async function sendTravelBookingStatusUpdateMail(travelBookingsFordate) {
  
  let bookedBy = travelBookingsFordate.bookedBy;
  const user = await CardDb.findOne({
    where: {
      cardno: travelBookingsFordate.cardno
    }
  });

  if(bookedBy) {
    bookedBy = await CardDb.findOne({
      where: {
        cardno: bookedBy
      }
    });
  }
  if(user) {
    sendMail({
      email: user.email,
      cc: bookedBy ? bookedBy.email : null,
      subject: 'Raj Pravas - Travel Booking Updated',
      template: 'rajPravasStatusUpdate',
      context: {
        name: user.issuedto,
        bookingid: travelBookingsFordate.bookingid,
        date: moment(travelBookingsFordate.date).format('Do MMMM, YYYY'),
        pickup: travelBookingsFordate.pickup_point,
        drop: travelBookingsFordate.drop_point,
        status: travelBookingsFordate.status
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

  // Check for existing bookings with same pickup/drop points
  for (const group of mumukshuGroup) {
    const { drop_point, mumukshus: groupMumukshus } = group;
    await checkTravelAlreadyBooked(date, {
      mumukshus: groupMumukshus,
      drop_point
    });
  }
  
  const bookings = await TravelDb.findAll({
    where: {
      type: TRAVEL_TYPE_REGULAR,
      status: {
        [Sequelize.Op.notIn]: [STATUS_ADMIN_CANCELLED, STATUS_CANCELLED]
      },
      date: date,
    }
  });

  const bookingGoingToRC = [], bookingsGoingFromRC = [];
  for(const booking of bookings) {
    if(booking.drop_point === RESEARCH_CENTRE) {
      bookingGoingToRC.push(booking);
    } 
    if(booking.pickup_point === RESEARCH_CENTRE) {
      bookingsGoingFromRC.push(booking);
    }
  }

  let travelBookingCountFromRC = bookingsGoingFromRC.length;
  let travelBookingCountToRC = bookingGoingToRC.length;
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
    
      const travelBookingCount = drop_point === RESEARCH_CENTRE 
        ? travelBookingCountToRC 
        : pickup_point === RESEARCH_CENTRE 
          ? travelBookingCountFromRC 
          : 0;
      
      const travelbookingStatus = await getTravelBookingStatus(
        type,
        date,
        travelBookingCount
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
      if(travelbookingStatus === STATUS_PAYMENT_PENDING) {
        createPendingTransaction(bookingId, TYPE_TRAVEL, t);
      }
      if(drop_point === RESEARCH_CENTRE) {
        travelBookingCountToRC++;
      } else if(pickup_point === RESEARCH_CENTRE) {
        travelBookingCountFromRC++;
      }
      userBookingIds[mumukshu] = [bookingId];
    }
  }
  await TravelDb.bulkCreate(bookingsToCreate, { transaction: t });
  return { userBookingIds, waitingBookingCount };
}
