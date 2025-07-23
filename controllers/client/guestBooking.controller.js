import {
  CardDb,
  GuestRelationship,
  FlatDb,
  UtsavDb
} from '../../models/associations.js';
import {
  STATUS_AVAILABLE,
  TYPE_ROOM,
  TYPE_FOOD,
  TYPE_ADHYAYAN,
  ERR_INVALID_BOOKING_TYPE,
  LUNCH_PRICE,
  BREAKFAST_PRICE,
  DINNER_PRICE,
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
  bookRoomForMumukshus
} from '../../helpers/roomBooking.helper.js';
import {
  generateOrderId,
  updateRazorpayTransactions,
  usableCredits
} from '../../helpers/transactions.helper.js';
import database from '../../config/database.js';
import getDates from '../../utils/getDates.js';
import ApiError from '../../utils/ApiError.js';
import {
  bookFoodForMumukshus,
  checkFoodAvailabilityForMumumkshus
} from '../../helpers/foodBooking.helper.js';
import {
  validateUtsavs,
  bookUtsavForMumukshus
} from '../../helpers/utsavBooking.helper.js';
import { bookAdhyayanForMumukshus, checkAdhyayanAvailabilityForMumukshus } from '../../helpers/adhyayanBooking.helper.js';

export const guestBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;
  var t = await database.transaction();
  req.transaction = t;

  let amount = 0;
  const userBookingIdMap = {};
  const waitingBookingCountMap = {};
  const transactionIds = [];

  switch (primary_booking.booking_type) {
    case TYPE_ROOM:
      const roomResult = await bookRoom(primary_booking, t, req.user);
      amount += roomResult.amount;
      setBookingIdMap(userBookingIdMap, TYPE_ROOM, roomResult.userBookingIds);
      break;

    case TYPE_FOOD:
      const foodResult = await bookFood(
        req.body,
        primary_booking,
        t,
        req.user
      );
      amount += foodResult.amount;
      transactionIds.push(...foodResult.transactionIds);
      break;

    case TYPE_ADHYAYAN:
      const adhyayanResult = await bookAdhyayan(primary_booking, t, req.user);
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
      const utsavResult = await bookUtsav(primary_booking, t, req.user);
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

  if (addons) {
    for (const addon of addons) {
      switch (addon.booking_type) {
        case TYPE_ROOM:
          const roomResult = await bookRoom(addon, t, req.user);
          amount += roomResult.amount;
          setBookingIdMap(
            userBookingIdMap,
            TYPE_ROOM,
            roomResult.userBookingIds
          );
          break;

        case TYPE_FOOD:
          const foodResult = await bookFood(
            req.body,
            addon,
            t,
            req.user
          );
          amount += foodResult.amount;
          transactionIds.push(...foodResult.transactionIds);
          break;

        case TYPE_ADHYAYAN:
          const adhyayanResult = await bookAdhyayan(addon, t, req.user);
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

        default:
          throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
      }
    }
  }

  var order = null;
  if (req.user.country == 'India' && amount > 0) {
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
      sendUnifiedEmail(
        cardno,
        bookings,
        req.user,
        BOOKING_STATUS_PENDING
      );
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
  switch (primary_booking.booking_type) {
    case TYPE_ROOM:
      response.roomDetails = await checkRoomAvailability(
        req.body.primary_booking,
        req.user,
        utsav
      );
      response.totalCharge += response.roomDetails.reduce(
        (partialSum, room) => partialSum + room.charge,
        0
      );
      break;

    case TYPE_FOOD:
      response.foodDetails = await checkFoodAvailability(
        req.body,
        req.body.primary_booking,
        req.user,
        utsav
      );
      response.totalCharge += response.foodDetails.charge;
      break;

    case TYPE_ADHYAYAN:
      response.adhyayanDetails = await checkAdhyayanAvailabilityForMumukshus(
        primary_booking.details.shibir_ids,
        primary_booking.details.guests
      );
      response.totalCharge += response.adhyayanDetails.reduce(
        (partialSum, adhyayan) => partialSum + adhyayan.charge,
        0
      );
      break;

    case TYPE_UTSAV:
      response.utsavDetails = await validateUtsavs(
        req.user,
        req.body.primary_booking.details.utsavid,
        req.body.primary_booking.details.guests
      );
      response.totalCharge += response.utsavDetails.reduce(
        (partialSum, utsav) => partialSum + utsav.charge,
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
          response.roomDetails = await checkRoomAvailability(
            addon,
            req.user,
            utsav
          );
          response.totalCharge += response.roomDetails.reduce(
            (partialSum, room) => partialSum + room.charge,
            0
          );
          break;

        case TYPE_FOOD:
          response.foodDetails = await checkFoodAvailability(
            req.body,
            addon,
            req.user,
            utsav
          );
          response.totalCharge += response.foodDetails.charge;
          break;

        case TYPE_ADHYAYAN:
          response.adhyayanDetails = await checkAdhyayanAvailabilityForMumukshus(
            addon.details.shibir_ids,
            addon.details.guests
          );
          response.totalCharge += response.adhyayanDetails.reduce(
            (partialSum, adhyayan) => partialSum + adhyayan.charge,
            0
          );
          break;

        //TODO: add travel for utsavs

        default:
          throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
      }
    }
  }

  return res.status(200).send({
    data: response
  });
};

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

  const flatDb = await FlatDb.findOne({
    attributes: ['flatno'],
    where: {
      owner: req.user.cardno
    }
  });

  if (!flatDb) throw new ApiError(404, 'Flat not found');

  validateDate(startDay, endDay);

  for (var guest of guests) {
    if (await checkFlatAlreadyBooked(startDay, endDay, guest))
      throw new ApiError(400, `flat already Booked for ${guest}`);
  }

  const nights = await calculateNights(startDay, endDay);
  var t = await database.transaction();

  let amount = 0;
  const bookingIds = [],
    userBookingIdMap = {};

  for (var guest of guests) {
    const result = await createFlatBooking(
      guest,
      startDay,
      endDay,
      nights,
      flatDb.dataValues.flatno,
      req.user,
      req.user.cardno,
      t
    );
    amount += result.discountedAmount;
    userBookingIdMap[guest] = [result.bookingId];
    bookingIds.push(result.bookingId);
  }

  var order = null;
  if (req.user.country == 'India' && amount > 0) {
    order = await generateOrderId(amount);
    await updateRazorpayTransactions(bookingIds, [], order.id, t);
  }

  await t.commit();

  sendUnifiedEmail(
    null,
    { [TYPE_FLAT]: bookingIds },
    req.user,
    BOOKING_STATUS_PENDING
  );

  Object.entries(userBookingIdMap)
    .filter(([guestCardNo]) => guestCardNo !== req.user.cardno) // Filter out the current user's cardno
    .forEach(([guestCardNo, bookings]) => {
      // Create the single-entry bookingMap object directly when calling the function
      sendUnifiedEmail(
        guestCardNo,
        { [TYPE_FLAT]: bookings },
        req.user,
        BOOKING_STATUS_PENDING
      );
    });

  return res.status(200).send({
    message: MSG_BOOKING_SUCCESSFUL,
    data: order ? order : { amount: 0 }
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
