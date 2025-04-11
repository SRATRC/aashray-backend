import {
  STATUS_AVAILABLE,
  TYPE_ROOM,
  STATUS_WAITING,
  TYPE_FOOD,
  TYPE_ADHYAYAN,
  ERR_INVALID_BOOKING_TYPE,
  ERR_ROOM_ALREADY_BOOKED,
  LUNCH_PRICE,
  BREAKFAST_PRICE,
  DINNER_PRICE,
  ERR_CARD_NOT_FOUND,
  TYPE_TRAVEL,
  ERR_INVALID_DATE,
  MSG_BOOKING_SUCCESSFUL,
  STATUS_RESIDENT,
  STATUS_MUMUKSHU,
  TYPE_UTSAV,
  STATUS_GUEST
} from '../../config/constants.js';
import {
  bookRoomDuringUtsavForMumukshus,
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
  bookFoodForMumukshusDuringUtsav,
  getFoodBookings
} from '../../helpers/foodBooking.helper.js';
import {
  bookUtsavForMumukshus,
  validateUtsavs
} from '../../helpers/utsavBooking.helper.js';
import { CardDb } from '../../models/associations.js';
import { validateCards } from '../../helpers/card.helper.js';
import { generateOrderId } from '../../helpers/transactions.helper.js';
import { calculateNights, validateDate,sendUnifiedEmail } from '../helper.js';
import database from '../../config/database.js';
import getDates from '../../utils/getDates.js';
import ApiError from '../../utils/ApiError.js';
import moment from 'moment';

export const mumukshuBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;
  var t = await database.transaction();
  req.transaction = t;

  let userBookingIdMap = new Map();
  

  let amount = await book(req.body, primary_booking, t, req.user,userBookingIdMap);

  if (addons) {
    for (const addon of addons) {
      amount += await book(req.body, addon, t, req.user,userBookingIdMap);
    }
  }

  let order = null;

  if (amount > 0)
    order =
      process.env.NODE_ENV == 'prod'
        ? await generateOrderId(amount)
        : { amount };
  await t.commit();
  //userBookingIdMap ONLY CONTAIN CARDNO

  for (const [key, value] of userBookingIdMap) {
    const userInfo = await CardDb.findOne({
      where: {
        cardno: key
      }
    });
  
    sendUnifiedEmail(userInfo, value);
  }  
  
  return res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL, order });
};

export const validateBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;

  const response = {
    roomDetails: [],
    adhyayanDetails: [],
    foodDetails: {},
    travelDetails: {},
    utsavDetails: [],
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

export const checkMumukshuOrGuest = async (req, res) => {
  const { mobno } = req.query;
  const cardDb = await CardDb.findOne({
    where: {
      mobno: mobno,
      res_status: [STATUS_RESIDENT, STATUS_MUMUKSHU, STATUS_GUEST]
    },
    attributes: ['cardno', 'issuedto', 'mobno', 'gender']
  });

  if (!cardDb) {
    throw new ApiError(404, ERR_CARD_NOT_FOUND);
  }

  return res.status(200).send({ data: cardDb });
};

function setBookingIdMap(userBookingIdMap,type,userIdArray){
  
  for (const cardno in userIdArray) {
    let bookingIds = userIdArray[cardno];
    if( userBookingIdMap.get(cardno))
      {
        let bookingTypeIds=userBookingIdMap.get(cardno);
        bookingTypeIds[type]=bookingIds;
      }
      else{
        let bookingTypeIds = [];
        bookingTypeIds[type]=bookingIds;
        userBookingIdMap.set(cardno,bookingTypeIds);
      }
}
 
}

async function book(body, data, t, user,userBookingIdMap) {
  let amount = 0;
  
  switch (data.booking_type) {
    case TYPE_ROOM:
      const roomResult = await bookRoom(body, data, t, user);
      amount += roomResult.amount;
      setBookingIdMap(userBookingIdMap,TYPE_ROOM,roomResult.userBookingIds);
      break;

    case TYPE_FOOD:
      await bookFood(body, data, t, user);
      break;

    case TYPE_TRAVEL:
      const travelResult = await bookTravel(data, t, user);
      setBookingIdMap(userBookingIdMap,TYPE_TRAVEL,travelResult.userBookingIds);
      break;

    case TYPE_ADHYAYAN:
      const adhyayanResult = await bookAdhyayan(data, t, user);
      amount += adhyayanResult.amount;
      setBookingIdMap(userBookingIdMap,TYPE_ADHYAYAN,adhyayanResult.userBookingIds);
      break;

    case TYPE_UTSAV:
      const utsavResult = await bookUtsav(data, t, user);
      amount += utsavResult.amount;
      break;

    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }

  return amount;
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

    case TYPE_UTSAV:
      response.utsavDetails = await validateUtsavs(
        data.details.utsavid,
        data.details.mumukshus
      );
      totalCharge += response.utsavDetails.reduce(
        (partialSum, utsav) => partialSum + utsav.charge,
        0
      );
      break;

    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }
  response.totalCharge += totalCharge;

  return response;
}

async function bookRoom(body, data, t, user) {
  const { checkin_date, checkout_date, mumukshuGroup } = data.details;

  let result = {};
  if (body.primary_booking.booking_type == TYPE_UTSAV) {
    result = await bookRoomDuringUtsavForMumukshus(
      body.primary_booking.details.utsavid,
      mumukshuGroup,
      t,
      user
    );
  } else {
    result = await bookRoomForMumukshus(
      checkin_date,
      checkout_date,
      mumukshuGroup,
      t,
      user
    );
  }

  return result;
}

async function bookFood(body, data, t, user) {
  const { start_date, end_date, mumukshuGroup } = data.details;

  if (body.primary_booking.booking_type == TYPE_UTSAV) {
    await bookFoodForMumukshusDuringUtsav(
      start_date,
      end_date,
      mumukshuGroup,
      body.primary_booking,
      body.addons,
      user.cardno,
      t
    );
  } else {
    await bookFoodForMumukshus(
      start_date,
      end_date,
      mumukshuGroup,
      body.primary_booking,
      body.addons,
      user.cardno,
      t
    );
  }
  return t;
}

async function bookAdhyayan(data, t, user) {
  const { shibir_ids, mumukshus } = data.details;

  const result = await bookAdhyayanForMumukshus(shibir_ids, mumukshus, t, user);

  return result;
}

async function bookTravel(data, t, user) {
  const { date, mumukshuGroup } = data.details;

  const result = await bookTravelForMumukshus(date, mumukshuGroup, t, user);

  return result;
}

async function bookUtsav(data, t, user) {
  const { utsavid, mumukshus } = data.details;

  const result = await bookUtsavForMumukshus(utsavid, mumukshus, t, user);

  return result;
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
