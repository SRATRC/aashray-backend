import {
  CardDb,
  GuestRelationship,
  FlatDb,
  UtsavDb
} from '../../models/associations.js';
import {
  TYPE_ROOM,
  TYPE_FOOD,
  TYPE_ADHYAYAN,
  ERR_INVALID_BOOKING_TYPE,
  MSG_BOOKING_SUCCESSFUL,
  MSG_UPDATE_SUCCESSFUL,
  STATUS_GUEST,
  TYPE_UTSAV,
  TYPE_FLAT,
  MSG_BOOKING_WAITING,
  BOOKING_STATUS_PENDING
} from '../../config/constants.js';
import {
  calculateNights,
  validateDate,
  createGuestsHelper,
  setBookingIdMap,
  retrieveBookingIds,
  sendUnifiedEmail,
  sendUnifiedEmailForBookedBy,
  checkFlatAlreadyBooked,
  setWaitingBookingCountMap
} from '../helper.js';
import {
  createFlatBooking,
  checkRoomAvailabilityForMumukshus,
  bookRoomForMumukshus,
  bookFlatForMumukshus
} from '../../helpers/roomBooking.helper.js';
import {
  generateOrderId,
  updateRazorpayTransactions
} from '../../helpers/transactions.helper.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import {
  bookFoodForMumukshus,
  checkFoodAvailabilityForMumumkshus
} from '../../helpers/foodBooking.helper.js';
import {
  validateUtsavs,
  bookUtsavForMumukshus
} from '../../helpers/utsavBooking.helper.js';
import {
  bookAdhyayanForMumukshus,
  checkAdhyayanAvailabilityForMumukshus
} from '../../helpers/adhyayanBooking.helper.js';

export const guestBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;
  var t = await database.transaction();
  req.transaction = t;

  const userBookingIdMap = {};
  const waitingBookingCountMap = {};
  const transactionIds = [];

  let amount = await book(
    req.body,
    primary_booking,
    t,
    req.user,
    userBookingIdMap,
    waitingBookingCountMap,
    transactionIds
  );

  if (addons) {
    for (const addon of addons) {
      amount += await book(
        req.body,
        addon,
        t,
        req.user,
        userBookingIdMap,
        waitingBookingCountMap,
        transactionIds
      );
    }
  }

  var order = null;
  const payLater = req.body.pay_later === true;

  if (amount > 0 && !payLater) {
    order = await generateOrderId(amount);
    const bookingIds = retrieveBookingIds(userBookingIdMap);
    await updateRazorpayTransactions(bookingIds, transactionIds, order.id, t);
  }

  await t.commit();

  // Sending email to logged in user for self or other mumkshus
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
    utsavDetails: [],
    totalCharge: 0
  };

  var utsav = null;
  if (primary_booking.booking_type == TYPE_UTSAV) {
    utsav = await UtsavDb.findOne({
      where: {
        id: primary_booking.details.utsavid
      }
    });
  }

  await validate(req.body, req.user, primary_booking, utsav, response);

  if (addons) {
    for (const addon of addons) {
      await validate(req.body, req.user, addon, utsav, response);
    }
  }

  return res.status(200).send({ data: response });
};
async function book(
  body,
  data,
  t,
  user,
  userBookingIdMap,
  waitingBookingCountMap,
  transactionIds
) {
  let amount = 0;

  switch (data.booking_type) {
    case TYPE_ROOM:
      const roomResult = await bookRoom(data, t, user);
      amount += roomResult.amount;
      setBookingIdMap(userBookingIdMap, TYPE_ROOM, roomResult.userBookingIds);
      break;

    case TYPE_FOOD:
      const foodResult = await bookFood(body, data, t, user);
      amount += foodResult.amount;
      transactionIds.push(...foodResult.transactionIds);
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

async function validate(body, user, data, utsav, response) {
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
      response.foodDetails = await checkFoodAvailability(
        body,
        data,
        user,
        utsav
      );
      totalCharge += response.foodDetails.charge;
      break;

    case TYPE_ADHYAYAN:
      response.adhyayanDetails = await checkAdhyayanAvailabilityForMumukshus(
        data.details.shibir_ids,
        data.details.guests
      );
      totalCharge += response.adhyayanDetails.reduce(
        (partialSum, adhyayan) => partialSum + adhyayan.charge,
        0
      );
      break;

    case TYPE_UTSAV:
      response.utsavDetails = await validateUtsavs(
        user,
        data.details.utsavid,
        data.details.guests
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

async function checkRoomAvailability(data, user, utsav) {
  const { checkin_date, checkout_date, guestGroup } = data.details;
  const result = await checkRoomAvailabilityForMumukshus(
    checkin_date,
    checkout_date,
    guestGroup,
    user,
    utsav
  );

  return result;
}

async function bookUtsav(data, t, user) {
  const { utsavid, guests } = data.details;
  const result = await bookUtsavForMumukshus(utsavid, guests, t, user);
  return result;
}

async function bookRoom(data, t, user) {
  const { checkin_date, checkout_date, guestGroup } = data.details;
  const result = await bookRoomForMumukshus(
    checkin_date,
    checkout_date,
    guestGroup,
    t,
    user
  );
  return result;
}

async function checkFoodAvailability(body, data, user, utsav) {
  let { start_date, end_date, guestGroup } = data.details;

  const result = await checkFoodAvailabilityForMumumkshus(
    start_date,
    end_date,
    guestGroup,
    body.primary_booking,
    body.addons,
    utsav,
    user,
    true
  );

  return result;
}

async function bookFood(body, data, t, user) {
  let { start_date, end_date, guestGroup } = data.details;
  const result = await bookFoodForMumukshus(
    start_date,
    end_date,
    guestGroup,
    body.primary_booking,
    body.addons,
    user.cardno,
    t,
    user.cardno
  );

  return result;
}

async function bookAdhyayan(data, t, user) {
  const { shibir_ids, guests } = data.details;
  const result = await bookAdhyayanForMumukshus(shibir_ids, guests, t, user);
  return result;
}

export const guestBookingFlat = async (req, res) => {
  const { guests, startDay, endDay } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const { userBookingIds, order } = await bookFlatForMumukshus(
    startDay,
    endDay,
    guests,
    req.user,
    t
  );

  await t.commit();

  sendUnifiedEmailForBookedBy(userBookingIds, req.user, BOOKING_STATUS_PENDING);

  Object.entries(userBookingIds)
    .filter(([cardno]) => cardno !== req.user.cardno) // Filter out the current user's cardno
    .forEach(([cardno, bookings]) => {
      sendUnifiedEmail(
        cardno,
        { [TYPE_FLAT]: bookings },
        req.user,
        BOOKING_STATUS_PENDING
      );
    });

  return res.status(200).send({
    message: MSG_BOOKING_SUCCESSFUL,
    data: order
  });
};

export const fetchGuests = async (req, res) => {
  const { cardno } = req.user;

  const guests = await CardDb.findAll({
    attributes: ['cardno', 'issuedto', 'mobno', 'gender', 'updatedAt'],
    include: [
      {
        model: GuestRelationship,
        where: { cardno: cardno },
        attributes: ['type']
      }
    ],
    raw: true,
    order: [['updatedAt', 'DESC']],
    limit: 10
  });

  return res.status(200).send({
    message: 'fetched results',
    data: guests
  });
};

export const createGuests = async (req, res) => {
  const { cardno } = req.user;
  const { guests } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const allGuests = await createGuestsHelper(cardno, guests, t);

  await t.commit();

  return res.status(200).send({
    message: MSG_UPDATE_SUCCESSFUL,
    guests: allGuests
  });
};

export const checkGuests = async (req, res) => {
  const { mobno } = req.params;

  const user = await CardDb.findOne({
    attributes: [
      'cardno',
      'issuedto',
      'mobno',
      'gender',
      'email',
      'res_status'
    ],
    where: { mobno: mobno }
  });
  if (!user) {
    return res.status(200).send({ message: 'Guest not found', data: null });
  }

  if (user.res_status == STATUS_GUEST) {
    return res.status(200).send({ message: 'Guest found', data: user });
  } else {
    throw new ApiError(401, 'User is not a guest');
  }
};
