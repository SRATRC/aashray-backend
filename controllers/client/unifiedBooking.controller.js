import {
  RoomDb,
  RoomBooking,
  TravelDb,
  FoodDb,
  ShibirBookingDb,
  ShibirDb,
  Transactions
} from '../../models/associations.js';
import {
  ROOM_STATUS_PENDING_CHECKIN,
  STATUS_PAYMENT_PENDING,
  STATUS_AVAILABLE,
  TYPE_ROOM,
  NAC_ROOM_PRICE,
  AC_ROOM_PRICE,
  STATUS_CONFIRMED,
  STATUS_WAITING,
  TYPE_TRAVEL,
  TYPE_FOOD,
  STATUS_RESIDENT,
  TRAVEL_PRICE,
  TRAVEL_TYPE_FULL,
  STATUS_PAYMENT_COMPLETED,
  TRANSACTION_TYPE_UPI,
  TYPE_ADHYAYAN,
  TRANSACTION_TYPE_CASH,
  FULL_TRAVEL_PRICE,
  RAZORPAY_FEE,
  ERR_INVALID_BOOKING_TYPE,
  ERR_ROOM_NO_BED_AVAILABLE,
  ERR_ROOM_ALREADY_BOOKED,
  ERR_ROOM_FAILED_TO_BOOK,
  ERR_ADHYAYAN_ALREADY_BOOKED,
  ERR_ADHYAYAN_NOT_FOUND,
  ERR_FOOD_ALREADY_BOOKED,
  ERR_ROOM_MUST_BE_BOOKED
} from '../../config/constants.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import {
  checkRoomAlreadyBooked,
  checkFlatAlreadyBooked,
  checkSpecialAllowance,
  calculateNights,
  isFoodBooked,
  validateDate,
  checkRoomBookingProgress,
  findRoom
} from '../helper.js';
import getDates from '../../utils/getDates.js';
import ApiError from '../../utils/ApiError.js';
import moment from 'moment';

export const unifiedBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;
  var t = await database.transaction();
  req.transaction = t;

  switch (primary_booking.booking_type) {
    case TYPE_ROOM:
      t = await bookRoom(req.body, req.user, req.body.primary_booking, t);
      break;

    case TYPE_FOOD:
      t = await bookFood(req, req.user, req.body.primary_booking, t);
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
          t = await bookFood(req, req.user, addon, t);
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
      // Food is always available
      break;

    case TYPE_TRAVEL:
      travelDetails = await checkTravelAvailability(req.body.primary_booking);
      totalCharge += travelDetails.charge;
      break;

    case TYPE_ADHYAYAN:
      adhyayanDetails = await checkAdhyayanAvailability(
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
          // Food is always available
          break;

        case TYPE_TRAVEL:
          travelDetails = await checkTravelAvailability(addon);
          totalCharge += travelDetails.charge;
          break;

        case TYPE_ADHYAYAN:
          adhyayanDetails = await checkAdhyayanAvailability(addon);
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

  return res.status(200).send({
    data: {
      roomDetails: roomDetails,
      adhyayanDetails: adhyayanDetails,
      travelDetails: travelDetails,
      taxes: totalCharge * RAZORPAY_FEE,
      totalCharge: totalCharge * (1 + RAZORPAY_FEE)
    }
  });
};

async function checkRoomAvailability(user, data) {
  const { checkin_date, checkout_date, floor_pref, room_type } = data.details;

  validateDate(checkin_date, checkout_date);

  const gender = floor_pref ? floor_pref + user.gender : user.gender;
  const nights = await calculateNights(checkin_date, checkout_date);

  var roomStatus = STATUS_WAITING;
  var charge = 0;

  if (nights > 0) {
    const roomno = await findRoom(
      checkin_date,
      checkout_date,
      room_type,
      gender
    );
    if (roomno) {
      roomStatus = STATUS_AVAILABLE;
      charge =
        room_type == 'nac' ? NAC_ROOM_PRICE * nights : AC_ROOM_PRICE * nights;
    }
  } else {
    // TODO: explain what is this case, where room_type = NA
    roomStatus = STATUS_AVAILABLE;
    charge = 0;
  }

  return {
    status: roomStatus,
    charge: charge
  };
}

async function bookRoom(body, user, data, t) {
  const { checkin_date, checkout_date, floor_pref, room_type } = data.details;
  if (await checkRoomAlreadyBooked(checkin_date, checkout_date, user.cardno)) {
    throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
  }

  validateDate(checkin_date, checkout_date);

  const nights = await calculateNights(checkin_date, checkout_date);

  const gender = floor_pref ? floor_pref + user.gender : user.gender;

  var roomno = undefined;
  var booking = undefined;

  if (nights > 0) {
    roomno = await findRoom(checkin_date, checkout_date, room_type, gender);
    if (!roomno) {
      throw new ApiError(400, ERR_ROOM_NO_BED_AVAILABLE);
    }

    booking = await RoomBooking.create(
      {
        bookingid: uuidv4(),
        cardno: user.cardno,
        roomno: roomno.dataValues.roomno,
        checkin: checkin_date,
        checkout: checkout_date,
        nights: nights,
        roomtype: room_type,
        status: ROOM_STATUS_PENDING_CHECKIN,
        gender: gender
      },
      { transaction: t }
    );

    if (!booking) {
      throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
    }

    // TODO: Apply Discounts on credits left
    // TODO: transaction status should be pending and updated to completed only after payment
    const transaction = await Transactions.create(
      {
        cardno: user.cardno,
        bookingid: booking.dataValues.bookingid,
        category: TYPE_ROOM,
        amount:
          room_type == 'nac' ? NAC_ROOM_PRICE * nights : AC_ROOM_PRICE * nights,
        upi_ref: body.transaction_ref || 'NA',
        status:
          body.transaction_type == TRANSACTION_TYPE_UPI
            ? STATUS_PAYMENT_COMPLETED
            : body.transaction_type == TRANSACTION_TYPE_CASH
            ? STATUS_CASH_COMPLETED
            : null,
        updatedBy: 'USER'
      },
      { transaction: t }
    );

    if (!transaction) {
      throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
    }
  } else {
    roomno = await RoomDb.findOne({
      where: {
        roomno: { [Sequelize.Op.eq]: 'NA' }
      },
      attributes: ['roomno']
    });

    booking = await RoomBooking.create(
      {
        bookingid: uuidv4(),
        cardno: user.cardno,
        roomno: roomno.dataValues.roomno,
        checkin: checkin_date,
        checkout: checkout_date,
        nights: nights,
        roomtype: 'NA',
        status: ROOM_STATUS_PENDING_CHECKIN,
        gender: gender
      },
      { transaction: t }
    );

    if (!booking) {
      throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
    }
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

async function bookFood(req, user, data, t) {
  const { start_date, end_date, breakfast, lunch, dinner, spicy, high_tea } =
    data.details;

  const meals = [
    { type: 'breakfast', toBook: breakfast },
    { type: 'lunch', toBook: lunch },
    { type: 'dinner', toBook: dinner }
  ];

  validateDate(start_date, end_date);

  if (
    !(
      (await checkRoomBookingProgress(
        start_date,
        end_date,
        req.body.primary_booking,
        req.body.addons
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
    )
  ) {
    throw new ApiError(403, ERR_ROOM_MUST_BE_BOOKED);
  }

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

async function checkAdhyayanAvailability(data) {
  const { shibir_ids } = data.details;

  const shibirs = await ShibirDb.findAll({
    where: {
      id: {
        [Sequelize.Op.in]: shibir_ids
      }
    }
  });

  var adhyayanDetails = [];
  var adhyayanStatus = STATUS_WAITING;
  var charge = 0;

  for (var shibir of shibirs) {
    if (shibir.dataValues.available_seats > 0) {
      adhyayanStatus = STATUS_AVAILABLE;
      charge = shibir.dataValues.amount;
    } else {
      adhyayanStatus = STATUS_WAITING;
      charge = 0;
    }
    adhyayanDetails.push({
      shibirId: shibir.dataValues.id,
      status: adhyayanStatus,
      charge: charge
    });
  }

  return adhyayanDetails;
}

async function bookAdhyayan(body, user, data, t) {
  const { shibir_ids } = data.details;

  const isBooked = await ShibirBookingDb.findAll({
    where: {
      shibir_id: {
        [Sequelize.Op.in]: shibir_ids
      },
      cardno: user.cardno,
      status: {
        [Sequelize.Op.in]: [
          STATUS_CONFIRMED,
          STATUS_WAITING,
          STATUS_PAYMENT_PENDING
        ]
      }
    }
  });

  if (isBooked.length > 0) {
    throw new ApiError(400, ERR_ADHYAYAN_ALREADY_BOOKED);
  }

  const shibirs = await ShibirDb.findAll({
    where: {
      id: {
        [Sequelize.Op.in]: shibir_ids
      }
    }
  });

  if (shibirs.length != shibir_ids.length) {
    throw new ApiError(400, ERR_ADHYAYAN_NOT_FOUND);
  }

  var booking_data = [];
  var transaction_data = [];

  for (var shibir of shibirs) {
    const bookingid = uuidv4();

    if (shibir.dataValues.available_seats > 0) {
      booking_data.push({
        bookingid: bookingid,
        shibir_id: shibir.dataValues.id,
        cardno: user.cardno,
        status:
          body.transaction_type == TRANSACTION_TYPE_UPI
            ? STATUS_CONFIRMED
            : STATUS_PAYMENT_PENDING
      });

      shibir.available_seats -= 1;
      await shibir.save({ transaction: t });

      // TODO: Apply Discounts on credits left
      // TODO: transaction status should be pending and updated to completed only after payment
      transaction_data.push({
        cardno: user.cardno,
        bookingid: bookingid,
        category: TYPE_ADHYAYAN,
        amount: shibir.dataValues.amount,
        upi_ref: body.transaction_ref ? body.transaction_ref : 'NA',
        status:
          body.transaction_type == TRANSACTION_TYPE_UPI
            ? STATUS_PAYMENT_COMPLETED
            : body.transaction_type == TRANSACTION_TYPE_CASH
            ? STATUS_CASH_COMPLETED
            : null,
        updatedBy: 'USER'
      });
    } else {
      booking_data.push({
        bookingid: bookingid,
        shibir_id: shibir.dataValues.id,
        cardno: user.cardno,
        status: STATUS_WAITING
      });
    }
  }

  await ShibirBookingDb.bulkCreate(booking_data, { transaction: t });
  await Transactions.bulkCreate(transaction_data, { transaction: t });

  return t;
}
