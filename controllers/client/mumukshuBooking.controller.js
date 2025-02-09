import database from '../../config/database.js';
import getDates from '../../utils/getDates.js';
import ApiError from '../../utils/ApiError.js';
import moment from 'moment';
import { CardDb } from '../../models/associations.js';
import {
  STATUS_AVAILABLE,
  TYPE_ROOM,
  STATUS_WAITING,
  TYPE_FOOD,
  TYPE_ADHYAYAN,
  RAZORPAY_FEE,
  ERR_INVALID_BOOKING_TYPE,
  ERR_ROOM_ALREADY_BOOKED,
  LUNCH_PRICE,
  BREAKFAST_PRICE,
  DINNER_PRICE,
  ERR_CARD_NOT_FOUND,
  TYPE_TRAVEL,
  ERR_INVALID_DATE,
  MSG_BOOKING_SUCCESSFUL
} from '../../config/constants.js';
import { calculateNights, validateDate } from '../helper.js';
import {
  bookRoomForMumukshus,
  checkRoomAlreadyBooked,
  findRoom,
  roomCharge
} from '../../helpers/roomBooking.helper.js';
import {
  bookAdhyayanForMumukshus,
  checkAdhyayanAvailabilityForMumukshus
} from '../../helpers/adhyayanBooking.helper.js';
import {
  bookTravelForMumukshus,
  checkTravelAlreadyBooked
} from '../../helpers/travelBooking.helper.js';
import {
  bookFoodForMumukshus,
  getFoodBookings
} from '../../helpers/foodBooking.helper.js';
import { validateCards } from '../../helpers/card.helper.js';
import { generateOrderId } from '../../helpers/transactions.helper.js';

export const mumukshuBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;
  var t = await database.transaction();
  req.transaction = t;

  let amount = await book(req.body, primary_booking, t, req.user);

  if (addons) {
    for (const addon of addons) {
      amount += await book(req.body, addon, t, req.user);
    }
  }

  let order = null;

  if (amount > 0)
    order =
      process.env.NODE_ENV == 'prod'
        ? await generateOrderId(amount)
        : { amount };
  await t.commit();
  return res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL, order });
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
  };

  await validate(primary_booking, response);

  if (addons) {
    for (const addon of addons) {
      await validate(addon, response);
    }
  }

  return res.status(200).send({ data: response });
};

export const checkMumukshu = async (req, res) => {
  const { mobno } = req.query;
  const cardDb = await CardDb.findOne({
    where: { mobno: mobno },
    attributes: ['cardno', 'issuedto', 'mobno']
  });

  if (!cardDb) {
    throw new ApiError(404, ERR_CARD_NOT_FOUND);
  }

  return res.status(200).send({ data: cardDb });
};

async function book(body, data, t, user) {
  let amount = 0;

  switch (data.booking_type) {
    case TYPE_ROOM:
      const roomResult = await bookRoom(data, t, user);
      amount += roomResult.amount;
      console.log('ROOM RESULT', roomResult.amount);
      break;

    case TYPE_FOOD:
      await bookFood(body, data, t, user);
      break;

    case TYPE_TRAVEL:
      await bookTravel(data, t, user);
      break;

    case TYPE_ADHYAYAN:
      const adhyayanResult = await bookAdhyayan(data, t, user);
      amount += adhyayanResult.amount;
      console.log('ADHYAYAN RESULT', adhyayanResult.amount);
      break;

    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }

  const taxes = Math.round(amount * RAZORPAY_FEE * 100) / 100;

  return amount + taxes;
}

async function validate(data, response) {
  let totalCharge = 0;
  switch (data.booking_type) {
    case TYPE_ROOM:
      response.roomDetails = await checkRoomAvailability(data);
      totalCharge += response.roomDetails.reduce(
        (partialSum, room) => partialSum + room.charge,
        0
      );
      break;

    case TYPE_FOOD:
      response.foodDetails = await checkFoodAvailability(data);
      // totalCharge += foodDetails.charge;
      break;

    case TYPE_ADHYAYAN:
      response.adhyayanDetails = await checkAdhyayanAvailabilityForMumukshus(
        data.details.shibir_ids,
        data.details.mumukshus
      );
      totalCharge += response.adhyayanDetails.reduce(
        (partialSum, adhyayan) => partialSum + adhyayan.charge,
        0
      );
      break;

    case TYPE_TRAVEL:
      response.travelDetails = await checkTravelAvailability(data);
      totalCharge += response.travelDetails.charge;
      break;

    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }

  const taxes = Math.round(totalCharge * RAZORPAY_FEE * 100) / 100;

  response.taxes += taxes;
  response.totalCharge += totalCharge + taxes;

  return response;
}

async function bookRoom(data, t, user) {
  const { checkin_date, checkout_date, mumukshuGroup } = data.details;

  const result = await bookRoomForMumukshus(
    checkin_date,
    checkout_date,
    mumukshuGroup,
    t,
    user
  );

  return result;
}

async function bookFood(body, data, t, user) {
  const { start_date, end_date, mumukshuGroup } = data.details;

  await bookFoodForMumukshus(
    start_date,
    end_date,
    mumukshuGroup,
    body.primary_booking,
    body.addons,
    user.cardno,
    t
  );
  return t;
}

async function bookAdhyayan(data, t, user) {
  const { shibir_ids, mumukshus } = data.details;

  const result = await bookAdhyayanForMumukshus(shibir_ids, mumukshus, t, user);

  return result;
}

async function bookTravel(data, t, user) {
  const { date, mumukshuGroup } = data.details;

  await bookTravelForMumukshus(date, mumukshuGroup, t, user);

  return t;
}

async function checkRoomAvailability(data) {
  const { checkin_date, checkout_date, mumukshuGroup } = data.details;
  validateDate(checkin_date, checkout_date);

  const mumukshus = mumukshuGroup.flatMap((group) => group.mumukshus);
  const cardDb = await validateCards(mumukshus);

  if (await checkRoomAlreadyBooked(checkin_date, checkout_date, mumukshus)) {
    throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
  }

  const nights = await calculateNights(checkin_date, checkout_date);

  var roomDetails = [];
  for (const group of mumukshuGroup) {
    const { roomType, floorType, mumukshus } = group;

    for (const mumukshu of mumukshus) {
      const card = cardDb.filter(
        (item) => item.dataValues.cardno == mumukshu
      )[0];

      var status = STATUS_WAITING;
      var charge = 0;

      const gender = floorType
        ? floorType + card.dataValues.gender
        : card.dataValues.gender;

      if (nights > 0) {
        const roomno = await findRoom(
          checkin_date,
          checkout_date,
          roomType,
          gender
        );
        if (roomno) {
          status = STATUS_AVAILABLE;
          charge = roomCharge(roomType) * nights;
        }
      } else {
        status = STATUS_AVAILABLE;
        charge = 0;
      }

      roomDetails.push({
        mumukshu,
        status,
        charge
      });
    }
  }

  return roomDetails;
}

async function checkFoodAvailability(data) {
  const { start_date, end_date, mumukshuGroup } = data.details;
  validateDate(start_date, end_date);

  const mumukshus = mumukshuGroup.flatMap((group) => group.mumukshus);
  await validateCards(mumukshus);

  const allDates = getDates(start_date, end_date);
  const bookings = await getFoodBookings(allDates, ...mumukshus);

  var charge = 0;

  for (const group of mumukshuGroup) {
    const { meals, mumukshus } = group;
    for (const date of allDates) {
      for (const mumukshu of mumukshus) {
        const booking = bookings[mumukshu] ? bookings[mumukshu][date] : null;
        if (booking) {
          charge +=
            (meals.includes('breakfast') && !booking['breakfast']
              ? BREAKFAST_PRICE
              : 0) +
            (meals.includes('lunch') && !booking['lunch'] ? LUNCH_PRICE : 0) +
            (meals.includes('dinner') && !booking['dinner'] ? DINNER_PRICE : 0);
        } else {
          charge +=
            (meals.includes('breakfast') ? BREAKFAST_PRICE : 0) +
            (meals.includes('lunch') ? LUNCH_PRICE : 0) +
            (meals.includes('dinner') ? DINNER_PRICE : 0);
        }
      }
    }
  }

  return {
    status: STATUS_AVAILABLE,
    charge
  };
}

async function checkTravelAvailability(data) {
  const { date, mumukshuGroup } = data.details;
  const today = moment().format('YYYY-MM-DD');
  if (date <= today) {
    throw new ApiError(400, ERR_INVALID_DATE);
  }

  const mumukshus = mumukshuGroup.flatMap((group) => group.mumukshus);
  await validateCards(mumukshus);
  await checkTravelAlreadyBooked(date, mumukshus);

  return {
    status: STATUS_WAITING,
    charge: 0
  };
}
