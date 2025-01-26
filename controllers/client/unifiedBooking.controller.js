import {
  TravelDb,
  FoodDb,
} from '../../models/associations.js';
import {
  STATUS_AVAILABLE,
  TYPE_ROOM,
  STATUS_CONFIRMED,
  STATUS_WAITING,
  TYPE_TRAVEL,
  TYPE_FOOD,
  STATUS_RESIDENT,
  TYPE_ADHYAYAN,
  RAZORPAY_FEE,
  ERR_INVALID_BOOKING_TYPE,
  ERR_ROOM_ALREADY_BOOKED,
  ERR_ROOM_MUST_BE_BOOKED
} from '../../config/constants.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import {
  checkFlatAlreadyBooked,
  checkSpecialAllowance,
  calculateNights,
  validateDate,
  checkRoomBookingProgress
} from '../helper.js';
import {
  bookDayVisit,
  checkRoomAlreadyBooked,
  createRoomBooking,
  findRoom,
  roomCharge
} from '../../helpers/roomBooking.helper.js';
import getDates from '../../utils/getDates.js';
import ApiError from '../../utils/ApiError.js';
import moment from 'moment';
import { 
  checkAdhyayanAlreadyBooked, 
  createAdhyayanBooking, 
  validateAdhyayans 
} from '../../helpers/adhyayanBooking.helper.js';

export const unifiedBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;
  var t = await database.transaction();
  req.transaction = t;

  switch (primary_booking.booking_type) {
    case TYPE_ROOM:
      t = await bookRoom(req.body, req.user, req.body.primary_booking, t);
      break;

    case TYPE_FOOD:
      t = await bookFood(req.body, req.user, req.body.primary_booking, t);
      break;

    case TYPE_TRAVEL:
      t = await bookTravel(req.user, req.body.primary_booking, t);
      break;

    case TYPE_ADHYAYAN:
      t = await bookAdhyayan(req.body, req.user, req.body.primary_booking, t);
      break;

    default:
      throw new ApiError(400, 'Invalid Booking Type');
  }

  if (addons) {
    for (const addon of addons) {
      switch (addon.booking_type) {
        case TYPE_ROOM:
          t = await bookRoom(req.body, req.user, addon, t);
          break;

        case TYPE_FOOD:
          t = await bookFood(req.body, req.user, addon, t);
          break;

        case TYPE_TRAVEL:
          t = await bookTravel(req.user, addon, t);
          break;

        case TYPE_ADHYAYAN:
          t = await bookAdhyayan(req.body, req.user, addon, t);
          break;

        default:
          throw new ApiError(400, 'Invalid Booking type');
      }
    }
  }

  await t.commit();
  return res.status(200).send({ message: 'Booking Successful' });
};

export const validateBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;

  var roomDetails = {};
  var foodDetails = {};
  var travelDetails = {};
  var adhyayanDetails = {};
  var totalCharge = 0;

  switch (primary_booking.booking_type) {
    case TYPE_ROOM:
      roomDetails = await checkRoomAvailability(
        req.user,
        req.body.primary_booking
      );
      totalCharge += roomDetails.charge;
      break;

    case TYPE_FOOD:
      foodDetails = await checkFoodAvailability(
        req.body,
        req.user,
        req.body.primary_booking
      );
      break;

    case TYPE_TRAVEL:
      travelDetails = await checkTravelAvailability(req.body.primary_booking);
      totalCharge += travelDetails.charge;
      break;

    case TYPE_ADHYAYAN:
      adhyayanDetails = await checkAdhyayanAvailability(
        req.user,
        req.body.primary_booking
      );
      totalCharge += adhyayanDetails.reduce(
        (partialSum, adhyayan) => partialSum + adhyayan.charge,
        0
      );
      break;

    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }

  if (addons) {
    for (const addon of addons) {
      switch (addon.booking_type) {
        case TYPE_ROOM:
          roomDetails = await checkRoomAvailability(req.user, addon);
          totalCharge += roomDetails.charge;
          break;

        case TYPE_FOOD:
          foodDetails = await checkFoodAvailability(
            req.body,
            req.user,
            addon
          );
          break;

        case TYPE_TRAVEL:
          travelDetails = await checkTravelAvailability(addon);
          totalCharge += travelDetails.charge;
          break;

        case TYPE_ADHYAYAN:
          adhyayanDetails = await checkAdhyayanAvailability(req.user, addon);
          totalCharge += adhyayanDetails.reduce(
            (partialSum, adhyayan) => partialSum + adhyayan.charge,
            0
          );
          break;

        default:
          throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
      }
    }
  }

  const taxes = Math.round(totalCharge * RAZORPAY_FEE * 100)/100;
  return res.status(200).send({
    data: {
      roomDetails: roomDetails,
      foodDetails: foodDetails,
      adhyayanDetails: adhyayanDetails,
      travelDetails: travelDetails,
      taxes: taxes, 
      totalCharge: totalCharge + taxes
    }
  });
};

async function checkRoomAvailability(user, data) {
  const { checkin_date, checkout_date, floor_pref, room_type } = data.details;

  validateDate(checkin_date, checkout_date);

  const gender = floor_pref ? floor_pref + user.gender : user.gender;
  const nights = await calculateNights(checkin_date, checkout_date);

  var status = STATUS_WAITING;
  var charge = 0;

  if (nights > 0) {
    const roomno = await findRoom(
      checkin_date,
      checkout_date,
      room_type,
      gender
    );
    if (roomno) {
      status = STATUS_AVAILABLE;
      charge = roomCharge(room_type) * nights;
    }
  } else {
    status = STATUS_AVAILABLE;
    charge = 0;
  }

  return {
    status,
    charge
  };
}

async function bookRoom(body, user, data, t) {
  const { checkin_date, checkout_date, floor_pref, room_type } = data.details;
  
  if (await checkRoomAlreadyBooked(checkin_date, checkout_date, user.cardno)) {
    throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
  }

  validateDate(checkin_date, checkout_date);

  const nights = await calculateNights(checkin_date, checkout_date);
  
  if (nights == 0) {
    await bookDayVisit(
      user.cardno,
      checkin_date,
      checkout_date,
      t
    );
  } else {
    await createRoomBooking(
      user.cardno,
      checkin_date,
      checkout_date,
      nights,
      room_type,
      user.gender,
      floor_pref,
      body.transaction_ref,
      body.transaction_type,
      t
    )
  }

  //   sendMail({
  //     email: user.email,
  //     subject: `Your Booking Confirmation for Stay at SRATRC`,
  //     template: 'rajSharan',
  //     context: {
  //       name: user.issuedto,
  //       bookingid: booking.dataValues.bookingid,
  //       checkin: booking.dataValues.checkin,
  //       checkout: booking.dataValues.checkout
  //     }
  //   });

  return t;
}

async function checkFoodAvailability(body, user, data) {
  const { start_date, end_date } = data.details;

  validateDate(start_date, end_date);

  await validateFood(body, user, start_date, end_date);

  return {
    status: STATUS_AVAILABLE,
    charge: 0
  };
}

async function validateFood(body, user, start_date, end_date) {
  if (!(
    (await checkRoomBookingProgress(
      start_date,
      end_date,
      body.primary_booking,
      body.addons
    )) ||
    (await checkRoomAlreadyBooked(
      start_date,
      end_date,
      user.cardno
    )) ||
    (await checkFlatAlreadyBooked(
      start_date,
      end_date,
      user.cardno
    )) ||
    user.res_status === STATUS_RESIDENT ||
    (await checkSpecialAllowance(
      start_date,
      end_date,
      user.cardno
    ))
  )) {
    throw new ApiError(403, ERR_ROOM_MUST_BE_BOOKED);
  }
}

async function bookFood(body, user, data, t) {
  const { start_date, end_date, breakfast, lunch, dinner, spicy, high_tea } =
    data.details;

  const meals = [
    { type: 'breakfast', toBook: breakfast },
    { type: 'lunch', toBook: lunch },
    { type: 'dinner', toBook: dinner }
  ];

  validateDate(start_date, end_date);
  await validateFood(body, user, start_date, end_date);

  const allDates = getDates(start_date, end_date);
  const bookingsToUpdate = await FoodDb.findAll({
    where: {
      cardno: user.cardno,
      date: { [Sequelize.Op.in]: allDates }
    }
  });

  for (const booking of bookingsToUpdate) {
    meals.forEach(({ type, toBook }) => {
      if (toBook && !booking[type])
        booking[type] = toBook;
    });
    booking.hightea = high_tea || 'NONE';
    booking.spicy = spicy;
    await booking.save({ transaction: t });
  }

  const bookedDates = bookingsToUpdate.map(booking => booking.date);
  const remainingDates = allDates.filter(date => !bookedDates.includes(date));

  var bookingsToCreate = [];
  for (var date of remainingDates) {
    bookingsToCreate.push({
      cardno: user.cardno,
      date: date,
      breakfast: breakfast,
      lunch: lunch,
      dinner: dinner,
      hightea: high_tea || 'NONE',
      spicy: spicy,
      plateissued: 0
    });
  }

  await FoodDb.bulkCreate(bookingsToCreate, { transaction: t });

  return t;
}

async function checkTravelAvailability(data) {
  // const { date, pickup_point, drop_point, type } = data.details;

  // // TODO: check if the status is CONFIRMED or WAITING and return status accordingly
  // const whereCondition = {
  //   status: { [Sequelize.Op.in]: [STATUS_CONFIRMED, STATUS_WAITING] },
  //   date: { [Sequelize.Op.eq]: date }
  // };

  // if (pickup_point == 'RC') whereCondition.pickup_point = pickup_point;
  // else if (drop_point == 'RC') whereCondition.drop_point = drop_point;

  // const travelBookings = await TravelDb.findAll({
  //   where: whereCondition
  // });

  // var travelStatus = STATUS_WAITING;
  // var charge = 0;

  // if (type == TRAVEL_TYPE_FULL) {
  //   if (travelBookings.length == 0) {
  //     travelStatus = STATUS_AVAILABLE;
  //     charge = FULL_TRAVEL_PRICE;
  //   }
  // } else {
  //   if (travelBookings.length < 5) {
  //     travelStatus = STATUS_AVAILABLE;
  //     charge = TRAVEL_PRICE;
  //   }
  // }

  return {
    status: STATUS_WAITING,
    charge: 0
  };
}

async function bookTravel(user, data, t) {
  const { date, pickup_point, drop_point, luggage, comments, type } =
    data.details;

  const today = moment().format('YYYY-MM-DD');
  if (date <= today) {
    throw new ApiError(400, 'Invalid Date');
  }

  const isBooked = await TravelDb.findOne({
    where: {
      cardno: user.cardno,
      status: { [Sequelize.Op.in]: [STATUS_CONFIRMED, STATUS_WAITING] },
      date: date
    }
  });
  if (isBooked) {
    throw new ApiError(400, 'Travel already booked on the selected date');
  }

  await TravelDb.create(
    {
      bookingid: uuidv4(),
      cardno: user.cardno,
      date: date,
      type: type,
      pickup_point: pickup_point,
      drop_point: drop_point,
      luggage: luggage,
      comments: comments,
      status: STATUS_WAITING
    },
    { transaction: t }
  );
  //   sendMail({
  //     email: user.email,
  //     subject: 'Your Booking for RajPravas',
  //     template: 'rajPravas',
  //     context: {
  //       name: user.issuedto,
  //       bookingid: booking.dataValues.bookingid,
  //       date: date,
  //       pickup: pickup_point,
  //       dropoff: drop_point
  //     }
  //   });

  return t;
}

async function checkAdhyayanAvailability(user, data) {
  const { shibir_ids } = data.details;

  await checkAdhyayanAlreadyBooked(shibir_ids, user.cardno);
  const shibirs = await validateAdhyayans(shibir_ids);

  var adhyayanDetails = [];
  var status = STATUS_WAITING;
  var charge = 0;

  for (var shibir of shibirs) {
    if (shibir.dataValues.available_seats > 0) {
      status = STATUS_AVAILABLE;
      charge = shibir.dataValues.amount;
    } else {
      status = STATUS_WAITING;
      charge = 0;
    }
    adhyayanDetails.push({
      shibirId: shibir.dataValues.id,
      status,
      charge
    });
  }

  return adhyayanDetails;
}

async function bookAdhyayan(body, user, data, t) {
  const { shibir_ids } = data.details;

  await checkAdhyayanAlreadyBooked(shibir_ids, user.cardno);
  const shibirs = await validateAdhyayans(shibir_ids);

  await createAdhyayanBooking(
    shibirs, 
    body.transaction_type,
    body.transaction_ref || 'NA',
    t,
    user.cardno, 
  );

  return t;
}
