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
  TRANSACTION_TYPE_CASH
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
  checkRoomBookingProgress
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
      t = await bookTravel(req.body, req.user, req.body.primary_booking, t);
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
          t = await bookTravel(req.body, req.user, addon, t);
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

async function bookRoom(body, user, data, t) {
  const { checkin_date, checkout_date, floor_pref, room_type } = data.details;
  if (await checkRoomAlreadyBooked(checkin_date, checkout_date, user.cardno)) {
    throw new ApiError(400, 'Room Already Booked');
  }

  validateDate(checkin_date, checkout_date);

  const gender = floor_pref ? floor_pref + user.gender : user.gender;
  const nights = await calculateNights(checkin_date, checkout_date);
  var roomno = undefined;
  var booking = undefined;

  if (nights > 0) {
    roomno = await RoomDb.findOne({
      attributes: ['roomno'],
      where: {
        roomno: {
          [Sequelize.Op.notLike]: 'NA%',
          [Sequelize.Op.notLike]: 'WL%',
          [Sequelize.Op.notIn]: Sequelize.literal(`(
                    SELECT roomno 
                    FROM room_booking 
                    WHERE NOT (checkout <= ${checkin_date} OR checkin >= ${checkout_date})
                )`),
          [Sequelize.Op.notIn]: Sequelize.literal(`(
                  SELECT roomno 
                  FROM guest_room_booking 
                  WHERE NOT (checkout <= '${checkin_date}' OR checkin >= '${checkout_date}')
              )`)
        },
        roomstatus: STATUS_AVAILABLE,
        roomtype: room_type,
        gender: gender
      },
      order: [
        Sequelize.literal(
          `CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED)`
        ),
        Sequelize.literal(`SUBSTRING(roomno, LENGTH(roomno))`)
      ],
      limit: 1
    });
    if (roomno == undefined) {
      throw new ApiError(400, 'No Beds Available');
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
      throw new ApiError(400, 'Failed to book a bed');
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
        upi_ref: body.transaction_ref ? body.transaction_ref : 'NA',
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
      throw new ApiError(400, 'Failed to book a bed');
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
      throw new ApiError(400, 'Failed to book a bed');
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

  validateDate(start_date, end_date);

  if (await isFoodBooked(start_date, end_date, user.cardno))
    throw new ApiError(403, 'Food already booked');

  if (
    !(
      (await checkRoomBookingProgress(
        start_date,
        end_date,
        req.body.primary_booking,
        req.body.addons
      )) ||
      (await checkRoomAlreadyBooked(start_date, end_date, user.cardno)) ||
      (await checkFlatAlreadyBooked(start_date, end_date, user.cardno)) ||
      user.res_status === STATUS_RESIDENT ||
      (await checkSpecialAllowance(start_date, end_date, user.cardno))
    )
  ) {
    throw new ApiError(
      403,
      'You do not have a room booked on one or more dates selected'
    );
  }

  const allDates = getDates(start_date, end_date);

  var food_data = [];
  for (var date of allDates) {
    food_data.push({
      cardno: user.cardno,
      date: date,
      breakfast: breakfast,
      lunch: lunch,
      dinner: dinner,
      hightea: high_tea,
      spicy: spicy,
      plateissued: 0
    });
  }

  await FoodDb.bulkCreate(food_data, { transaction: t });

  return t;
}

async function bookTravel(body, user, data, t) {
  const { date, pickup_point, drop_point, luggage, comments, type } =
    data.details;

  const today = moment().format('YYYY-MM-DD');
  if (date < today) {
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

  const whereCondition = {
    status: { [Sequelize.Op.in]: [STATUS_CONFIRMED] },
    date: { [Sequelize.Op.eq]: date }
  };

  if (pickup_point == 'RC') whereCondition.pickup_point = pickup_point;
  else if (drop_point == 'RC') whereCondition.drop_point = drop_point;

  const travelBookings = await TravelDb.findAll({
    where: whereCondition
  });

  if (type == TRAVEL_TYPE_FULL) {
    if (travelBookings.length > 0) {
      throw new ApiError(
        400,
        'Full travel booking not allowed on the selected date'
      );
    }
  }

  console.log(travelBookings);

  const booking = await TravelDb.create(
    {
      bookingid: uuidv4(),
      cardno: user.cardno,
      date: date,
      type: type,
      pickup_point: pickup_point,
      drop_point: drop_point,
      luggage: luggage,
      comments: comments,
      status: travelBookings.length < 5 ? STATUS_CONFIRMED : STATUS_WAITING
    },
    { transaction: t }
  );

  // TODO: Apply Discounts on credits left
  // TODO: transaction status should be pending and updated to completed only after payment
  if (travelBookings.length < 5) {
    const bookingTransaction = await Transactions.create(
      {
        cardno: user.cardno,
        bookingid: booking.dataValues.bookingid,
        category: TYPE_TRAVEL,
        amount: TRAVEL_PRICE,
        upi_ref: body.transaction_ref ? body.transaction_ref : 'NA',
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

    if (!booking || !bookingTransaction) {
      throw new ApiError(500, 'Failed to book travel');
    }
  }

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
    throw new ApiError(400, 'Shibir already booked');
  }

  const shibirs = await ShibirDb.findAll({
    where: {
      id: {
        [Sequelize.Op.in]: shibir_ids
      }
    }
  });

  if (shibirs.length != shibir_ids.length) {
    throw new ApiError(400, 'Shibir not found');
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

  // await ShibirBookingDb.create(
  //   {
  //     bookingid: bookingid,
  //     shibir_id: req.body.shibir_id,
  //     cardno: req.body.cardno,
  //     status: STATUS_PAYMENT_PENDING
  //   },
  //   { transaction: t }
  // );

  // await ShibirBookingTransaction.create(
  //   {
  //     cardno: req.body.cardno,
  //     bookingid: bookingid,
  //     type: TYPE_EXPENSE,
  //     amount: shibir.dataValues.amount,
  //     upi_ref: 'NA',
  //     status: STATUS_PAYMENT_PENDING,
  //     updatedBy: 'USER'
  //   },
  //   { transaction: t }
  // );

  return t;
}
