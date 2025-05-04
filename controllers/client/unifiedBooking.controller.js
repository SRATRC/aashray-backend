import {
  STATUS_AVAILABLE,
  TYPE_ROOM,
  STATUS_WAITING,
  TYPE_TRAVEL,
  TYPE_FOOD,
  TYPE_ADHYAYAN,
  ERR_INVALID_BOOKING_TYPE,
  MSG_BOOKING_SUCCESSFUL,
  STATUS_OPEN,
  TYPE_UTSAV,
  ERR_INVALID_DATE
} from '../../config/constants.js';
import {
  bookRoomDuringUtsavForMumukshus,
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
  bookFoodForMumukshus,
  bookFoodForMumukshusDuringUtsav,
  createGroupFoodRequest,
  validateFood
} from '../../helpers/foodBooking.helper.js';
import {
  bookUtsavForMumukshus,
  checkUtsavAlreadyBooked,
  validateUtsavs
} from '../../helpers/utsavBooking.helper.js';
import { generateOrderId, updateRazorpayTransactions } from '../../helpers/transactions.helper.js';
import {
  bookTravelForMumukshus,
  checkTravelAlreadyBooked
} from '../../helpers/travelBooking.helper.js';
import {
  calculateNights,
  validateDate,
  sendUnifiedEmail,
  setBookingIdMap,
  retrieveBookingIds
} from '../helper.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import moment from 'moment';

export const unifiedBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;

  if (!primary_booking) throw new ApiError(400, 'Invalid Request');

  var t = await database.transaction();
  req.transaction = t;
  const userBookingIdMap = {};

  let amount = await book(
    req.user,
    req.body,
    primary_booking,
    userBookingIdMap,
    t
  );

  if (addons) {
    for (const addon of addons) {
      amount += await book(req.user, req.body, addon, userBookingIdMap, t);
    }
  }

  const order = await generateOrderId(amount);
  const bookingIds = retrieveBookingIds(userBookingIdMap);  
  await updateRazorpayTransactions(bookingIds, order.id, t);
  
  await t.commit();

  // for (const cardno in userBookingIdMap) {
  //   const bookings = userBookingIdMap[cardno];
  //   sendUnifiedEmail(cardno, bookings, req.user);
  // }

  return res.status(200).send({ message: MSG_BOOKING_SUCCESSFUL, data: order });
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

  await validate(req.body, req.user, primary_booking, response);

  if (addons) {
    for (const addon of addons) {
      await validate(req.body, req.user, addon, response);
    }
  }

  return res.status(200).send({ data: response });
};

async function book(user, body, data, userBookingIdMap, t) {
  let amount = 0;

  switch (data.booking_type) {
    case TYPE_ROOM:
      const roomResult = await bookRoom(user, body, data, t);
      amount += roomResult.amount;
      setBookingIdMap(userBookingIdMap, TYPE_ROOM, roomResult.userBookingIds);
      break;

    case TYPE_FOOD:
      t = await bookFood(body, user, data, t);
      break;

    case TYPE_TRAVEL:
      const travelResult = await bookTravel(user, data, t);
      setBookingIdMap(
        userBookingIdMap,
        TYPE_TRAVEL,
        travelResult.userBookingIds
      );
      break;

    case TYPE_ADHYAYAN:
      const adhyayanResult = await bookAdhyayan(user, data, t);
      amount += adhyayanResult.amount;
      setBookingIdMap(
        userBookingIdMap,
        TYPE_ADHYAYAN,
        adhyayanResult.userBookingIds
      );
      break;

    case TYPE_UTSAV:
      const utsavResult = await bookUtsav(user, data, t);
      amount += utsavResult.amount;
      // TODO: send emails for Utsav
      // setBookingIdMap(userBookingIdMap, TYPE_UTSAV, utsavResult.bookingIds);
      break;

    default:
      throw new ApiError(400, 'Invalid Booking Type');
  }
  return amount;
}

async function validate(body, user, data, response) {
  let totalCharge = 0;

  switch (data.booking_type) {
    case TYPE_ROOM:
      response.roomDetails = await checkRoomAvailability(user, data);
      totalCharge += response.roomDetails.charge;
      break;

    case TYPE_FOOD:
      response.foodDetails = await checkFoodAvailability(user, body, data);
      // food charges are not added for Mumukshus
      break;

    case TYPE_TRAVEL:
      response.travelDetails = await checkTravelAvailability(user, data);
      totalCharge += response.travelDetails.charge;
      break;

    case TYPE_ADHYAYAN:
      response.adhyayanDetails = await checkAdhyayanAvailability(user, data);
      totalCharge += response.adhyayanDetails.reduce(
        (partialSum, adhyayan) => partialSum + adhyayan.charge,
        0
      );
      break;

    case TYPE_UTSAV:
      response.utsavDetails = await checkUtsavAvailability(user, data);
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

async function bookRoom(user, body, data, t) {
  let { checkin_date, checkout_date, floor_pref, room_type } = data.details;

  let result = {};
  if (body.primary_booking.booking_type == TYPE_UTSAV) {
    result = await bookRoomDuringUtsavForMumukshus(
      body.primary_booking.details.utsavid,
      [
        {
          mumukshus: [user.cardno],
          roomType: room_type,
          floorType: floor_pref,
          packageid: body.primary_booking.details.packageid,
          checkin_date,
          checkout_date
        }
      ],
      t,
      user
    );
  } else {
    result = await bookRoomForMumukshus(
      checkin_date,
      checkout_date,
      [
        {
          mumukshus: [user.cardno],
          roomType: room_type,
          floorType: floor_pref
        }
      ],
      t,
      user
    );
  }

  return result;
}

async function bookFood(body, user, data, t) {
  const { start_date, end_date, breakfast, lunch, dinner, spicy, high_tea } =
    data.details;

  if (body.primary_booking.booking_type == TYPE_UTSAV) {
    const mumukshuGroup = createGroupFoodRequest(
      user.cardno,
      breakfast,
      lunch,
      dinner,
      spicy,
      high_tea
    );

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
      user.cardno,
      t
    );
  }

  return t;
}

async function bookTravel(user, data, t) {
  const {
    date,
    pickup_point,
    drop_point,
    luggage,
    comments,
    type,
    arrival_time = null,
    leaving_post_adhyayan
  } = data.details;

  const result = await bookTravelForMumukshus(
    date,
    [
      {
        mumukshus: [user.cardno],
        pickup_point,
        drop_point,
        luggage,
        comments,
        type,
        arrival_time,
        leaving_post_adhyayan
      }
    ],
    t,
    user
  );

  return result;
}

async function bookAdhyayan(user, data, t) {
  const { shibir_ids } = data.details;

  const result = await bookAdhyayanForMumukshus(
    shibir_ids,
    [user.cardno],
    t,
    user
  );

  return result;
}

async function bookUtsav(user, data, t) {
  const { utsavid, packageid, arrival, carno, other } = data.details;

  const result = await bookUtsavForMumukshus(
    utsavid,
    [
      {
        cardno: user.cardno,
        packageid,
        arrival,
        carno,
        other
      }
    ],
    t,
    user
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

async function checkTravelAvailability(user, data) {
  const { date } = data.details;

  const today = moment().format('YYYY-MM-DD');
  if (date <= today) {
    throw new ApiError(400, ERR_INVALID_DATE);
  }

  await checkTravelAlreadyBooked(date, [user.cardno]);

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
    if (
      shibir.dataValues.available_seats > 0 &&
      shibir.dataValues.status == STATUS_OPEN
    ) {
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

async function checkUtsavAvailability(user, data) {
  const { utsavid, packageid } = data.details;

  await checkUtsavAlreadyBooked(utsavid, [
    {
      cardno: user.cardno,
      packageid
    }
  ]);

  const utsavDetails = await validateUtsavs(utsavid, [
    {
      cardno: user.cardno,
      packageid
    }
  ]);

  return utsavDetails;
}
