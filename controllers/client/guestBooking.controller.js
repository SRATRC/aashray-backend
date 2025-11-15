import {
  CardDb,
  GuestRelationship,
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
  checkRoomAvailabilityForMumukshus,
  bookRoomForMumukshus,
  bookFlatForMumukshus,
  roomCharge
} from '../../helpers/roomBooking.helper.js';
import {
  generateOrderId,
  updateRazorpayTransactions
} from '../../helpers/transactions.helper.js';
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
import { validateCards } from '../../helpers/card.helper.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';

export const guestBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;

  validateFlatBookingConstraints(primary_booking, addons);

  var t = await database.transaction();
  req.transaction = t;

  const userBookingIdMap = {};
  const waitingBookingCountMap = {};
  const transactionIds = [];

  let utsav = null;
  if (primary_booking.booking_type == TYPE_UTSAV) {
    utsav = await UtsavDb.findOne({
      where: {
        id: primary_booking.details.utsavid
      }
    });
  }

  let amount = await book(
    req.body,
    primary_booking,
    t,
    req.user,
    utsav,
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
        utsav,
        userBookingIdMap,
        waitingBookingCountMap,
        transactionIds
      );
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
    flatDetails: [],
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
      const roomResult = await bookRoom(data, t, user, utsav);
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

    case TYPE_FLAT:
      const flatResult = await bookFlat(data, t, user);
      amount += flatResult.amount;
      setBookingIdMap(userBookingIdMap, TYPE_FLAT, flatResult.userBookingIds);
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

    case TYPE_FLAT:
      response.flatDetails = await checkFlatAvailability(data, user);
      totalCharge += response.flatDetails.reduce(
        (partialSum, flat) => partialSum + flat.charge,
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

async function bookRoom(data, t, user, utsav) {
  const { checkin_date, checkout_date, guestGroup } = data.details;
  const result = await bookRoomForMumukshus(
    checkin_date,
    checkout_date,
    guestGroup,
    t,
    user,
    utsav
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

/**
 * @deprecated This endpoint is deprecated. Use the unified booking endpoint with TYPE_FLAT as primary_booking instead.
 */
export const guestBookingFlat = async (req, res) => {
  logger.warn(
    '[DEPRECATED] guestBookingFlat endpoint is deprecated. Use unified booking endpoint instead.'
  );

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

  const requiredFields = ['name', 'gender', 'mobno', 'dob', 'type'];

  const missing = guests
    .map((guest, index) => {
      const missingFields = requiredFields.filter((field) => !guest[field]);
      return missingFields.length > 0 ? { index, fields: missingFields } : null;
    })
    .filter(Boolean);

  if (missing.length > 0) {
    const msg = missing
      .map((m) => `Guest ${m.index + 1} has missing [${m.fields.join(', ')}]`)
      .join('; ');
    throw new ApiError(400, msg);
  }

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
      'dob',
      'res_status'
    ],
    raw: true,
    where: { mobno: mobno }
  });
  if (!user) {
    return res.status(200).send({ message: 'Guest not found', data: null });
  }

  if (user.res_status == STATUS_GUEST) {
    const isTypeAvailable = await GuestRelationship.findOne({
      attributes: ['type'],
      where: { guest: user.cardno }
    });

    const resp = {
      ...user,
      type: isTypeAvailable && isTypeAvailable.type
    };

    return res.status(200).send({ message: 'Guest found', data: resp });
  } else {
    throw new ApiError(401, 'User is not a guest');
  }
};

async function bookFlat(data, t, user) {
  const { checkin_date, checkout_date, guests } = data.details;

  // Handle missing checkout_date
  if (!checkout_date) {
    throw new ApiError(400, 'checkout date is required for flat booking');
  }

  if (guests.length === 0) {
    throw new ApiError(
      400,
      'At least one guest must be specified for flat booking'
    );
  }

  const result = await bookFlatForMumukshus(
    checkin_date,
    checkout_date,
    guests,
    user,
    t
  );
  return {
    amount: result.order.amount,
    userBookingIds: result.userBookingIds
  };
}

async function checkFlatAvailability(data, user) {
  const { checkin_date, checkout_date, guests } = data.details;

  // Handle missing checkout_date
  if (!checkout_date) {
    throw new ApiError(400, 'checkout_date is required for flat booking');
  }

  if (guests.length === 0) {
    throw new ApiError(
      400,
      'At least one guest must be specified for flat booking'
    );
  }

  // Check if user owns a flat
  const flat = await FlatDb.findOne({
    attributes: ['flatno'],
    where: {
      owner: user.cardno
    }
  });

  if (!flat) {
    throw new ApiError(404, `Flat not found for ${user.cardno}`);
  }

  validateDate(checkin_date, checkout_date);
  await validateCards(guests);

  // Check if any guest already has a flat booking for these dates
  for (const guest of guests) {
    if (await checkFlatAlreadyBooked(checkin_date, checkout_date, guest)) {
      throw new ApiError(
        400,
        `Flat already booked for ${guest} during selected dates`
      );
    }
  }

  const nights = await calculateNights(checkin_date, checkout_date);
  const flatDetails = [];

  for (const guest of guests) {
    // Check if this guest is the flat owner
    const isFlatOwner = await FlatDb.findOne({
      where: {
        owner: guest,
        flatno: flat.flatno
      }
    });

    const charge = isFlatOwner ? 0 : roomCharge('nac') * nights;

    flatDetails.push({
      guest: guest,
      flatno: flat.flatno,
      nights: nights,
      charge: charge,
      status: 'available'
    });
  }

  return flatDetails;
}

function validateFlatBookingConstraints(primary_booking, addons) {
  // Check if TYPE_FLAT is in addons (not allowed)
  if (addons && addons.length > 0) {
    const flatAddon = addons.find((addon) => addon.booking_type === TYPE_FLAT);
    if (flatAddon) {
      throw new ApiError(
        400,
        'Flat booking cannot be added as an addon. It must be the primary booking type.'
      );
    }
  }

  // Check if TYPE_FLAT is primary booking with other primary booking types
  if (primary_booking && primary_booking.booking_type === TYPE_FLAT) {
    // Flat booking should be standalone - no addons of accommodation types allowed
    if (addons && addons.length > 0) {
      const accommodationAddons = addons.filter(
        (addon) =>
          addon.booking_type === TYPE_ROOM || addon.booking_type === TYPE_UTSAV
      );
      if (accommodationAddons.length > 0) {
        throw new ApiError(
          400,
          'Flat booking cannot be combined with other accommodation types (room or utsav bookings).'
        );
      }
    }
  }
}
