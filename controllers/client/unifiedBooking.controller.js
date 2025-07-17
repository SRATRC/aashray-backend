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
  ERR_INVALID_DATE,
  STATUS_AWAITING_CONFIRMATION,
  MSG_BOOKING_WAITING,
  BOOKING_STATUS_PENDING
} from '../../config/constants.js';
import {
  bookRoomForMumukshus,
  findRoom,
  roomCharge,
  checkRoomAvailabilityDuringUtsav
} from '../../helpers/roomBooking.helper.js';
import {
  bookAdhyayanForMumukshus,
  checkAdhyayanAlreadyBooked,
  validateAdhyayans
} from '../../helpers/adhyayanBooking.helper.js';
import {
  bookFoodForMumukshus,
  createGroupFoodRequest,
  validateFood
} from '../../helpers/foodBooking.helper.js';
import {
  bookUtsavForMumukshus,
  checkUtsavAlreadyBooked,
  validateUtsavs
} from '../../helpers/utsavBooking.helper.js';
import {
  generateOrderId,
  updateRazorpayTransactions,
  usableCredits
} from '../../helpers/transactions.helper.js';
import {
  bookTravelForMumukshus,
  checkTravelAlreadyBooked
} from '../../helpers/travelBooking.helper.js';
import {
  calculateNights,
  validateDate,
  setBookingIdMap,
  retrieveBookingIds,
  setWaitingBookingCountMap,
  sendUnifiedEmailForBookedBy
} from '../helper.js';
import { UtsavDb } from '../../models/associations.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import moment from 'moment';
import Sequelize from 'sequelize';

export const unifiedBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;

  if (!primary_booking) throw new ApiError(400, 'Invalid Request');

  var t = await database.transaction();
  req.transaction = t;
  const userBookingIdMap = {};
  const waitingBookingCountMap = {};
  let amount = await book(
    req.user,
    req.body,
    primary_booking,
    userBookingIdMap,
    waitingBookingCountMap,
    t
  );

  if (addons) {
    for (const addon of addons) {
      amount += await book(
        req.user,
        req.body,
        addon,
        userBookingIdMap,
        waitingBookingCountMap,
        t
      );
    }
  }

  var order = null;
  if (req.user.country == 'India' && amount > 0) {
    order = await generateOrderId(amount);
    const bookingIds = retrieveBookingIds(userBookingIdMap);
    await updateRazorpayTransactions(bookingIds, [], order.id, t);
  }

  await t.commit();
  //Sending email to logged in user for self or other mumkshus
  sendUnifiedEmailForBookedBy(
    userBookingIdMap,
    req.user,
    BOOKING_STATUS_PENDING
  );
  for (const cardno in userBookingIdMap) {
    if (cardno != req.user.cardno) {
      const bookings = userBookingIdMap[cardno];
      //Sending email to other mumkshu & Guest
      sendUnifiedEmail(cardno, bookings, req.user, BOOKING_STATUS_PENDING);
    }
  }

  let message = MSG_BOOKING_SUCCESSFUL;
  if (Object.keys(waitingBookingCountMap).length > 0) {
    message = MSG_BOOKING_WAITING;
  }
  return res.status(200).send({
    message: message,
    data: order ? order : { amount: 0 },
    waitingBookingCountMap: waitingBookingCountMap
  });
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
  let utsav = null;
  if (primary_booking.booking_type == TYPE_UTSAV) {
    utsav = await UtsavDb.findOne({
      where: {
        id: primary_booking.details.utsavid
      }
    });
  } else {
    utsav = await UtsavDb.findOne({
      where: {
        [Sequelize.Op.and]: [
          {
            end_date: {
              [Sequelize.Op.gte]:
                primary_booking.details.checkin_date ||
                primary_booking.details.date
            }
          },
          {
            start_date: {
              [Sequelize.Op.lte]:
                primary_booking.details.checkout_date ||
                primary_booking.details.date
            }
          }
        ]
      }
    });
  }
  await validate(req.body, req.user, primary_booking, response, utsav);

  if (addons) {
    for (const addon of addons) {
      await validate(req.body, req.user, addon, response, utsav);
    }
  }

  return res.status(200).send({ data: response });
};

async function book(
  user,
  body,
  data,
  userBookingIdMap,
  waitingBookingCountMap,
  t
) {
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
      setWaitingBookingCountMap(
        waitingBookingCountMap,
        TYPE_TRAVEL,
        travelResult.waitingBookingCount,
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
      setWaitingBookingCountMap(
        waitingBookingCountMap,
        TYPE_ADHYAYAN,
        adhyayanResult.waitingBookingCount,
        adhyayanResult.userBookingIds
      );
      break;

    case TYPE_UTSAV:
      const utsavResult = await bookUtsav(user, data, t);
      amount += utsavResult.amount;
      setBookingIdMap(userBookingIdMap, TYPE_UTSAV, utsavResult.userBookingIds);
      setWaitingBookingCountMap(
        waitingBookingCountMap,
        TYPE_UTSAV,
        utsavResult.waitingBookingCount,
        utsavResult.userBookingIds
      );
      break;

    default:
      throw new ApiError(400, 'Invalid Booking Type');
  }
  return amount;
}

async function validate(body, user, data, response, utsav) {
  let totalCharge = 0;

  switch (data.booking_type) {
    case TYPE_ROOM:
      response.roomDetails = await checkRoomAvailability(user, data, utsav);
      totalCharge += response.roomDetails.reduce(
        (partialSum, room) => partialSum + room.charge,
        0
      );
      break;

    case TYPE_FOOD:
      response.foodDetails = await checkFoodAvailability(
        user,
        body,
        data,
        utsav
      );
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
  const { checkin_date, checkout_date, floor_pref, room_type } = data.details;

  const result = await bookRoomForMumukshus(
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

  return result;
}

async function bookFood(body, user, data, t) {
  let { start_date, end_date, breakfast, lunch, dinner, spicy, high_tea } =
    data.details;

  if (!end_date) {
    end_date = start_date;
  }

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

  return t;
}

async function bookTravel(user, data, t) {
  const {
    date,
    pickup_point,
    drop_point,
    luggage,
    comments,
    special_request,
    type,
    arrival_time = null,
    total_people = 1,
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
        comments: comments || special_request,
        type,
        arrival_time,
        total_people,
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
  const { utsavid, packageid, arrival, carno, other, volunteer } = data.details;

  const result = await bookUtsavForMumukshus(
    utsavid,
    [
      {
        cardno: user.cardno,
        packageid,
        arrival,
        carno,
        other,
        volunteer
      }
    ],
    t,
    user
  );

  return result;
}

async function checkRoomAvailability(user, data, utsav) {
  const { checkin_date, checkout_date, floor_pref, room_type } = data.details;

  validateDate(checkin_date, checkout_date);

  const gender = floor_pref ? floor_pref + user.gender : user.gender;

  if (utsav) {
    return checkRoomAvailabilityDuringUtsav(
      checkin_date,
      checkout_date,
      room_type,
      gender,
      utsav,
      user.cardno,
      user
    );
  } else {
    const nights = await calculateNights(checkin_date, checkout_date);

    var status = STATUS_WAITING;
    var charge = 0;
    var availableCredits = 0;

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
        availableCredits = usableCredits(user, TYPE_ROOM, charge);
      }
    } else {
      status = STATUS_AVAILABLE;
    }

    return [
      {
        mumukshu: user.cardno,
        status: status,
        charge: charge,
        availableCredits: availableCredits,
        dates: checkin_date + ' to ' + checkout_date
      }
    ];
  }
}

async function checkFoodAvailability(user, body, data, utsav) {
  let { start_date, end_date } = data.details;

  if (!end_date) {
    end_date = start_date;
  }

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
  const { date, pickup_point, drop_point } = data.details;

  const today = moment().format('YYYY-MM-DD');
  if (date < today) {
    throw new ApiError(400, ERR_INVALID_DATE);
  }

  // Check if travel is either to or from Research Centre
  if (pickup_point !== 'Research Centre' && drop_point !== 'Research Centre') {
    throw new ApiError(400, 'Travel must be either to or from Research Centre');
  }

  await checkTravelAlreadyBooked(date, { 
    mumukshus: [user.cardno],
    pickup_point,
    drop_point
  });

  return {
    status: STATUS_AWAITING_CONFIRMATION,
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

  const utsavDetails = await validateUtsavs(user, utsavid, [
    {
      cardno: user.cardno,
      packageid
    }
  ]);

  return utsavDetails;
}
