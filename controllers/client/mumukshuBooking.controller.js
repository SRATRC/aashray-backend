import {
  STATUS_AVAILABLE,
  TYPE_ROOM,
  STATUS_WAITING,
  TYPE_FOOD,
  TYPE_ADHYAYAN,
  ERR_INVALID_BOOKING_TYPE,
  ERR_ROOM_ALREADY_BOOKED,
  ERR_CARD_NOT_FOUND,
  TYPE_TRAVEL,
  ERR_INVALID_DATE,
  MSG_BOOKING_SUCCESSFUL,
  MSG_BOOKING_WAITING,
  STATUS_RESIDENT,
  STATUS_MUMUKSHU,
  TYPE_UTSAV,
  STATUS_GUEST,
  STATUS_AWAITING_CONFIRMATION,
  BOOKING_STATUS_PENDING,
  STATUS_SEVA_KUTIR,
  RESEARCH_CENTRE
} from '../../config/constants.js';
import {
  bookRoomForMumukshus,
  checkRoomAlreadyBooked,
  findRoom,
  roomCharge,
  checkRoomAvailabilityDuringUtsav
} from '../../helpers/roomBooking.helper.js';
import { UtsavDb } from '../../models/associations.js';
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
  validateFood
} from '../../helpers/foodBooking.helper.js';
import {
  bookUtsavForMumukshus,
  validateUtsavs
} from '../../helpers/utsavBooking.helper.js';
import { CardDb } from '../../models/associations.js';
import { validateCards } from '../../helpers/card.helper.js';
import {
  generateOrderId,
  updateRazorpayTransactions,
  usableCredits
} from '../../helpers/transactions.helper.js';
import {
  calculateNights,
  validateDate,
  setBookingIdMap,
  retrieveBookingIds,
  sendUnifiedEmailForBookedBy,
  sendUnifiedEmail,
  setWaitingBookingCountMap
} from '../helper.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import moment from 'moment';

export const mumukshuBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;
  var t = await database.transaction();
  req.transaction = t;

  const userBookingIdMap = {};
  const waitingBookingCountMap = {};
  let amount = await book(
    req.body,
    primary_booking,
    t,
    req.user,
    userBookingIdMap,
    waitingBookingCountMap
  );

  if (addons) {
    for (const addon of addons) {
      amount += await book(
        req.body,
        addon,
        t,
        req.user,
        userBookingIdMap,
        waitingBookingCountMap
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
  let message =
    Object.keys(waitingBookingCountMap).length > 0
      ? MSG_BOOKING_WAITING
      : MSG_BOOKING_SUCCESSFUL;

  return res.status(200).send({
    message: message,
    order: order ? order : { amount: 0 },
    waitingBookingCountMap
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

  await validate(req.body, req.user, primary_booking, response);

  if (addons) {
    for (const addon of addons) {
      await validate(req.body, req.user, addon, response);
    }
  }

  return res.status(200).send({ data: response });
};

export const checkMumukshuOrGuest = async (req, res) => {
  const { mobno } = req.query;
  const cardDb = await CardDb.findOne({
    where: {
      mobno: mobno
    },
    attributes: ['cardno', 'issuedto', 'mobno', 'gender', 'res_status']
  });

  if (!cardDb) {
    throw new ApiError(404, ERR_CARD_NOT_FOUND);
  }

  if (
    ![STATUS_RESIDENT, STATUS_MUMUKSHU, STATUS_SEVA_KUTIR].includes(
      cardDb.res_status
    )
  ) {
    throw new ApiError(401, 'User is not a mumukshu');
  }

  return res.status(200).send({ data: cardDb });
};

async function book(
  body,
  data,
  t,
  user,
  userBookingIdMap,
  waitingBookingCountMap
) {
  let amount = 0;

  switch (data.booking_type) {
    case TYPE_ROOM:
      const roomResult = await bookRoom(body, data, t, user);
      amount += roomResult.amount;
      setBookingIdMap(userBookingIdMap, TYPE_ROOM, roomResult.userBookingIds);
      break;

    case TYPE_FOOD:
      await bookFood(body, data, t, user);
      break;

    case TYPE_TRAVEL:
      const travelResult = await bookTravel(data, t, user);
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
      const adhyayanResult = await bookAdhyayan(data, t, user);
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
      const utsavResult = await bookUtsav(data, t, user);
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
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }

  return amount;
}

async function validate(body, user, data, response) {
  let utsav = null;
  if (body.primary_booking.booking_type == TYPE_UTSAV) {
    utsav = await UtsavDb.findOne({
      where: {
        id: body.primary_booking.details.utsavid
      }
    });
  }
  let totalCharge = 0;
  switch (data.booking_type) {
    case TYPE_ROOM:
      response.roomDetails = await checkRoomAvailability(data, user, utsav);
      totalCharge += response.roomDetails.reduce(
        (partialSum, room) => partialSum + room.charge,
        0
      );
      break;

    case TYPE_FOOD:
      response.foodDetails = await checkFoodAvailability(body, data, utsav);
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
        user,
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
  let { start_date, end_date, mumukshuGroup } = data.details;
  if (!end_date) {
    end_date = start_date;
  }

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
  const result = await bookTravelForMumukshus(date, mumukshuGroup, t, user);
  return result;
}

async function bookUtsav(data, t, user) {
  const { utsavid, mumukshus } = data.details;
  const result = await bookUtsavForMumukshus(utsavid, mumukshus, t, user);
  return result;
}

async function checkRoomAvailability(data, user, utsav) {
  const { checkin_date, checkout_date, mumukshuGroup } = data.details;
  validateDate(checkin_date, checkout_date);

  let nights = await calculateNights(checkin_date, checkout_date);
  const mumukshus = mumukshuGroup.flatMap((group) => group.mumukshus);
  const cardDb = await validateCards(mumukshus);

  if (await checkRoomAlreadyBooked(checkin_date, checkout_date, ...mumukshus)) {
    throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
  }

  var roomDetails = [];
  for (const group of mumukshuGroup) {
    const { roomType, floorType, mumukshus } = group;

    for (const mumukshu of mumukshus) {
      const card = cardDb.filter(
        (item) => item.dataValues.cardno == mumukshu
      )[0];

      const gender = floorType
        ? floorType + card.dataValues.gender
        : card.dataValues.gender;

      if (utsav) {
        roomDetails.push(
          ...(await checkRoomAvailabilityDuringUtsav(
            checkin_date,
            checkout_date,
            roomType,
            gender,
            utsav,
            mumukshu,
            user
          ))
        );
      } else {
        var status = STATUS_WAITING;
        var charge = 0;
        var availableCredits = 0;

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
            availableCredits = usableCredits(user, TYPE_ROOM, charge);
          }
        } else {
          status = STATUS_AVAILABLE;
        }

        roomDetails.push({
          mumukshu,
          status,
          charge,
          availableCredits
        });
      }
    }
  }

  return roomDetails;
}

async function checkFoodAvailability(body, data, utsav) {
  let { start_date, end_date, mumukshuGroup } = data.details;
  if (!end_date) {
    end_date = start_date;
  }

  validateDate(start_date, end_date);

  const mumukshus = mumukshuGroup.flatMap((group) => group.mumukshus);

  const cards = await validateCards(mumukshus);
  for (const card of cards) {
    await validateFood(
      start_date,
      end_date,
      body.primary_booking,
      body.addons,
      card
    );
  }

  return {
    status: STATUS_AVAILABLE,
    charge: 0
  };
}

async function checkTravelAvailability(data) {
  const { date, mumukshuGroup } = data.details;
  const today = moment().format('YYYY-MM-DD');
  if (date < today) {
    throw new ApiError(400, ERR_INVALID_DATE);
  }

  const mumukshus = mumukshuGroup.flatMap((group) => group.mumukshus);
  await validateCards(mumukshus);

  for (const group of mumukshuGroup) {
    const { pickup_point, drop_point, mumukshus: groupMumukshus } = group;

    if (pickup_point !== RESEARCH_CENTRE && drop_point !== RESEARCH_CENTRE) {
      throw new ApiError(
        400,
        'Travel must be either to or from Research Centre'
      );
    }

    await checkTravelAlreadyBooked(date, {
      mumukshus: groupMumukshus,
      drop_point
    });
  }

  return {
    status: STATUS_AWAITING_CONFIRMATION,
    charge: 0
  };
}
