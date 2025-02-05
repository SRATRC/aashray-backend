import database from '../../config/database.js';
import Sequelize from 'sequelize';
import ApiError from '../../utils/ApiError.js';
import { 
  TravelDb
} from '../../models/associations.js';
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
import {
  calculateNights,
  validateDate,
  sendUnifiedEmail
} from '../helper.js';
import {
  bookRoomForMumukshus,
  findRoom,
  roomCharge
} from '../../helpers/roomBooking.helper.js';
import {
  bookAdhyayanForMumukshus,
  checkAdhyayanAlreadyBooked,
  validateAdhyayans
} from '../../helpers/adhyayanBooking.helper.js';
import { 
  generateOrderId
} from '../../helpers/transactions.helper.js';
import {
  bookFoodForMumukshus,
  createGroupFoodRequest,
  validateFood
} from '../../helpers/foodBooking.helper.js';
import {
  bookTravelForMumukshus
} from '../../helpers/travelBooking.helper.js';

export const unifiedBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;

  if (!primary_booking) throw new ApiError(400, 'Invalid Request');

  var t = await database.transaction();
  req.transaction = t;
  let bookingIds=[];

  let amount = await book(req.user, req.body, primary_booking,bookingIds, t);

  if (addons) {
    for (const addon of addons) {
      amount += await book(req.user, req.body, addon,bookingIds, t);
    }
  }

  
  const order = process.env.NODE_ENV == 'prod' 
    ? (await generateOrderId(amount)) 
    : { amount };

  await t.commit();
  sendUnifiedEmail(req.user,bookingIds);
  return res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL, data: order });
};

export const validateBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;

  const response = {
    roomDetails: [],
    adhyayanDetails: [],
    foodDetails: {},
    travelDetails: {},
    taxes: 0,
    totalCharge: 0
  }

  await validate(req.body, req.user, primary_booking, response);

  if (addons) {
    for (const addon of addons) {
      await validate(req.body, req.user, addon, response);
    }
  }

  return res.status(200).send({ data: response });
};

async function book(user, body, data,bookingIds,t) {
  let amount = 0;
  
  switch (data.booking_type) {
    case TYPE_ROOM:
      const roomResult = await bookRoom(user, data, t);
      amount += roomResult.amount;
      bookingIds[TYPE_ROOM]= roomResult.bookingIds;
      break;

    case TYPE_FOOD:
      t = await bookFood(body, user, data, t);
      break;

    case TYPE_TRAVEL:
      const travelResult = await bookTravel(user, data, t);
      bookingIds[TYPE_TRAVEL]=travelResult.bookingIds;
      break;

    case TYPE_ADHYAYAN:
      const adhyayanResult = await bookAdhyayan(user, data, t);
      amount += adhyayanResult.amount;
      bookingIds[TYPE_ADHYAYAN]=adhyayanResult.bookingIds;
      break;

    default:
      throw new ApiError(400, 'Invalid Booking Type');
  }

  const taxes = Math.round(amount * RAZORPAY_FEE * 100) / 100;
 
  return amount + taxes;
}

async function validate(body, user, data, response) {
  let totalCharge = 0;

  switch (data.booking_type) {
    case TYPE_ROOM:
      response.roomDetails = await checkRoomAvailability(
        user,
        data
      );
      totalCharge += response.roomDetails.charge;
      break;

    case TYPE_FOOD:
      response.foodDetails = await checkFoodAvailability(
        user,
        body,
        data
      );
      // food charges are not added for Mumukshus
      break;

    case TYPE_TRAVEL:
      response.travelDetails = await checkTravelAvailability(data);
      totalCharge += response.travelDetails.charge;
      break;

    case TYPE_ADHYAYAN:
      response.adhyayanDetails = await checkAdhyayanAvailability(
        user,
        data
      );
      totalCharge += response.adhyayanDetails.reduce(
        (partialSum, adhyayan) => partialSum + adhyayan.charge,
        0
      );
      break;

    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }

  const taxes = Math.round(totalCharge * RAZORPAY_FEE * 100) / 100;

  response.taxes += taxes;
  response.totalCharge += totalCharge + taxes;

  return response;
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

  const mumukshuGroup = createGroupFoodRequest(
    user.cardno,
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
    'USER',
    t
  );

  return t;
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

  const result=await bookTravelForMumukshus(
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

  const bookingIds=result.bookingIds;
  return {t,bookingIds};
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

async function checkFoodAvailability(user, body, data) {
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