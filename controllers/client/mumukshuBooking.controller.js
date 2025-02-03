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
import database from '../../config/database.js';
import getDates from '../../utils/getDates.js';
import ApiError from '../../utils/ApiError.js';
import {
  createAdhyayanBooking,
  checkAdhyayanAlreadyBooked,
  validateAdhyayans,
  bookAdhyayanForMumukshus
} from '../../helpers/adhyayanBooking.helper.js';
import { bookTravelForMumukshus, checkTravelAlreadyBooked } from '../../helpers/travelBooking.helper.js';
import moment from 'moment';
import { bookFoodForMumukshus, getFoodBookings } from '../../helpers/foodBooking.helper.js';
import { validateCards } from '../../helpers/card.helper.js';

export const mumukshuBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;
  var t = await database.transaction();
  req.transaction = t;

  switch (primary_booking.booking_type) {
    case TYPE_ROOM:
      t = await bookRoom(req.body.primary_booking, t);
      break;

    case TYPE_FOOD:
      t = await bookFood(req.body, req.body.primary_booking, t);
      break;

    case TYPE_TRAVEL:
      t = await bookTravel(req.body.primary_booking, t);
      break;

    case TYPE_ADHYAYAN:
      t = await bookAdhyayan(req.body, req.body.primary_booking, t);
      break;

    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }

  if (addons) {
    for (const addon of addons) {
      switch (addon.booking_type) {
        case TYPE_ROOM:
          t = await bookRoom(req.body, addon, t);
          break;

        case TYPE_FOOD:
          t = await bookFood(req.body, addon, t);
          break;

        case TYPE_TRAVEL:
          t = await bookTravel(addon, t);
          break;

        case TYPE_ADHYAYAN:
          t = await bookAdhyayan(req.body, addon, t);
          break;

        default:
          throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
      }
    }
  }

  await t.commit();
  return res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL });
};

export const validateBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;

  var roomDetails = [];
  var adhyayanDetails = [];
  var foodDetails = {};
  var travelDetails = {};
  var totalCharge = 0;

  switch (primary_booking.booking_type) {
    case TYPE_ROOM:
      roomDetails = await checkRoomAvailability(req.body.primary_booking);
      totalCharge += roomDetails.reduce(
        (partialSum, room) => partialSum + room.charge,
        0
      );
      break;

    case TYPE_FOOD:
      foodDetails = await checkFoodAvailability(req.body.primary_booking);
      // totalCharge += foodDetails.charge;
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

    case TYPE_TRAVEL:
      travelDetails = await checkTravelAvailability(req.body.primary_booking);
      totalCharge += travelDetails.charge;
      break;

    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }

  if (addons) {
    for (const addon of addons) {
      switch (addon.booking_type) {
        case TYPE_ROOM:
          roomDetails = await checkRoomAvailability(addon);
          totalCharge += roomDetails.reduce(
            (partialSum, room) => partialSum + room.charge,
            0
          );
          break;

        case TYPE_FOOD:
          foodDetails = await checkFoodAvailability(addon);
          // food charges are not added for Mumukshus
          break;

        case TYPE_ADHYAYAN:
          adhyayanDetails = await checkAdhyayanAvailability(addon);
          totalCharge += adhyayanDetails.reduce(
            (partialSum, adhyayan) => partialSum + adhyayan.charge,
            0
          );
          break;

        case TYPE_TRAVEL:
          travelDetails = await checkTravelAvailability(addon);
          totalCharge += travelDetails.charge;
          break;

        default:
          throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
      }
    }
  }

  const taxes = Math.round(totalCharge * RAZORPAY_FEE * 100) / 100;
  return res.status(200).send({
    data: {
      roomDetails,
      adhyayanDetails,
      foodDetails,
      travelDetails,
      taxes,
      totalCharge: totalCharge + taxes
    }
  });
};

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

async function bookRoom(data, t) {
  const { checkin_date, checkout_date, mumukshuGroup } = data.details;

  await bookRoomForMumukshus(
    checkin_date,
    checkout_date,
    mumukshuGroup,
    t
  );

  return t;
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

async function bookFood(body, data, t) {
  const { start_date, end_date, mumukshuGroup } = data.details;

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

async function checkAdhyayanAvailability(data) {
  const { shibir_ids, mumukshus } = data.details;

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

async function bookAdhyayan(body, data, t) {
  const { shibir_ids, mumukshus } = data.details;

  await bookAdhyayanForMumukshus(
    shibir_ids,
    mumukshus,
    t
  );

  return t;
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

async function bookTravel(data, t) {
  const { date, mumukshuGroup } = data.details;

  await bookTravelForMumukshus(
    date,
    mumukshuGroup,
    t
  );

  return t;
}

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
