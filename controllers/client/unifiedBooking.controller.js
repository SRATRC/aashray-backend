import { TravelDb } from '../../models/associations.js';
import {
  STATUS_AVAILABLE,
  TYPE_ROOM,
  STATUS_CONFIRMED,
  STATUS_WAITING,
  TYPE_TRAVEL,
  TYPE_FOOD,
  TYPE_ADHYAYAN,
  RAZORPAY_FEE,
  ERR_INVALID_BOOKING_TYPE,
  MSG_BOOKING_SUCCESSFUL,
  ERR_TRAVEL_ALREADY_BOOKED
} from '../../config/constants.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import {
  calculateNights,
  validateDate,
} from '../helper.js';
import {
  bookRoomForMumukshus,
  findRoom,
  roomCharge
} from '../../helpers/roomBooking.helper.js';
import ApiError from '../../utils/ApiError.js';
import {
  bookAdhyayanForMumukshus,
  checkAdhyayanAlreadyBooked,
  createAdhyayanBooking,
  validateAdhyayans
} from '../../helpers/adhyayanBooking.helper.js';
import { generateOrderId } from '../../helpers/transactions.helper.js';
import { bookFoodForMumukshus, validateFood } from '../../helpers/foodBooking.helper.js';
import { bookTravelForMumukshus } from '../../helpers/travelBooking.helper.js';

export const unifiedBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;

  var t = await database.transaction();
  req.transaction = t;

  let amount = 0;

  if (!primary_booking) throw new ApiError(400, 'Invalid Request');

  switch (primary_booking.booking_type) {
    case TYPE_ROOM:
      const roomResult = await bookRoom(req.user, req.body.primary_booking, t);
      amount += roomResult.amount;
      break;

    case TYPE_FOOD:
      t = await bookFood(req.body, req.user, req.body.primary_booking, t);
      break;

    case TYPE_TRAVEL:
      t = await bookTravel(req.user, req.body.primary_booking, t);
      break;

    case TYPE_ADHYAYAN:
      const adhyayanResult = await bookAdhyayan(
        req.user,
        req.body.primary_booking,
        t
      );
      amount += adhyayanResult.amount;
      break;

    default:
      throw new ApiError(400, 'Invalid Booking Type');
  }

  if (addons) {
    for (const addon of addons) {
      switch (addon.booking_type) {
        case TYPE_ROOM:
          const roomResult = await bookRoom(req.user, addon, t);
          amount += roomResult.amount;
          break;

        case TYPE_FOOD:
          t = await bookFood(req.body, req.user, addon, t);
          break;

        case TYPE_TRAVEL:
          t = await bookTravel(req.user, addon, t);
          break;

        case TYPE_ADHYAYAN:
          const adhyayanResult = await bookAdhyayan(req.user, addon, t);
          amount += adhyayanResult.amount;
          break;

        default:
          throw new ApiError(400, 'Invalid Booking type');
      }
    }
  }

  const taxes = Math.round(amount * RAZORPAY_FEE * 100) / 100;
  const finalAmount = amount + taxes;

  const order = process.env.NODE_ENV == 'prod' ? (await generateOrderId(finalAmount)) : [];

  await t.commit();
  return res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL, data: order });
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
      // food charges are not added for Mumukshus
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
          foodDetails = await checkFoodAvailability(req.body, req.user, addon);
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

  const taxes = Math.round(totalCharge * RAZORPAY_FEE * 100) / 100;
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

async function bookRoom(user, data, t) {
  const { checkin_date, checkout_date, floor_pref, room_type } = data.details;

  const result = await bookRoomForMumukshus(
    checkin_date,
    checkout_date,
    [{
      mumukshus: [ user.cardno ],
      roomType: room_type,
      floorType: floor_pref
    }],
    t
  );

  return result;
}

async function checkFoodAvailability(body, user, data) {
  const { start_date, end_date } = data.details;

  validateDate(start_date, end_date);

  await validateFood(
    start_date, 
    end_date, 
    body.primary_booking, 
    body.addons, 
    user
  );

  return {
    status: STATUS_AVAILABLE,
    charge: 0
  };
}

async function bookFood(body, user, data, t) {
  const { 
    start_date, 
    end_date, 
    breakfast, 
    lunch, 
    dinner, 
    spicy, 
    high_tea 
  } = data.details;

  const mumukshuGroup = createMumukshuGroup(
    user,
    breakfast,
    lunch,
    dinner, 
    spicy,
    high_tea
  );

  await bookFoodForMumukshus(
    start_date,
    end_date,
    mumukshuGroup,
    body.primary_booking,
    body.addons,
    t
  );

  return t;
}

async function checkTravelAvailability(data) {
  const { date, pickup_point, drop_point, type } = data.details;

  const whereCondition = {
    status: { [Sequelize.Op.in]: [STATUS_CONFIRMED, STATUS_WAITING] },
    date: { [Sequelize.Op.eq]: date }
  };

  if (pickup_point == 'RC') whereCondition.pickup_point = pickup_point;
  else if (drop_point == 'RC') whereCondition.drop_point = drop_point;

  const travelBookings = await TravelDb.findAll({
    where: whereCondition
  });

  if (travelBookings.length > 0) {
    throw new ApiError(400, ERR_TRAVEL_ALREADY_BOOKED);
  }

  return {
    status: STATUS_WAITING,
    charge: 0
  };
}

async function bookTravel(user, data, t) {
  const { 
    date, 
    pickup_point, 
    drop_point, 
    luggage, 
    comments, 
    type 
  } = data.details;

  await bookTravelForMumukshus(
    date,
    [{
      mumukshus: [ user.cardno ],
      pickup_point,
      drop_point,
      luggage,
      comments,
      type
    }],
    t
  );

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

async function bookAdhyayan(user, data, t) {
  const { shibir_ids } = data.details;

  const result = await bookAdhyayanForMumukshus(
    shibir_ids,
    [ user.cardno ],
    t
  );

  return result;
}

function createMumukshuGroup(
  user,
  breakfast,
  lunch,
  dinner, 
  spicy,
  high_tea
) {

  const meals = []
  if (breakfast) meals.push('breakfast');
  if (lunch) meals.push('lunch');
  if (dinner) meals.push('dinner');

  return [{
    mumukshus: [ user.cardno ],
    meals,
    spicy,
    high_tea
  }];
}

function createRoomMumukshuGroup(
  user,
  roomType, 
  floorType,
) {

  return 
}