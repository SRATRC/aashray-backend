import {
  CardDb,
  GuestRelationship,
  FlatDb,
  UtsavDb,
  ShibirBookingDb,
  TravelDb,
  RoomBooking,
  UtsavBooking,
  FlatBooking,
  ShibirDb,
  UtsavPackagesDb,
  FoodDb
} from '../../models/associations.js';
import { Op } from 'sequelize';
import { sendUnifiedWhatsApp } from '../../helpers/whatsapp.helper.js';
import { sendWhatsAppMessage } from '../../utils/sendWhatsAppMessage.js';
import { formatWhatsAppPhone } from '../../utils/phoneFormatter.js';
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
  TYPE_TRAVEL,
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
import { attachUserContext } from '../../middleware/Logger.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';

async function fetchFreshDetailsForCard(cardno, userBookingIdMap) {
  const typeMap = userBookingIdMap[cardno] || {};
  const adhyanIds = Array.isArray(typeMap[TYPE_ADHYAYAN]) ? typeMap[TYPE_ADHYAYAN].map(String).filter(Boolean) : [];
  const travelIds = Array.isArray(typeMap[TYPE_TRAVEL]) ? typeMap[TYPE_TRAVEL].map(String).filter(Boolean) : [];
  const roomIds   = Array.isArray(typeMap[TYPE_ROOM]) ? typeMap[TYPE_ROOM].map(String).filter(Boolean) : [];
  const utsavIds  = Array.isArray(typeMap[TYPE_UTSAV]) ? typeMap[TYPE_UTSAV].map(String).filter(Boolean) : [];
  const flatIds   = Array.isArray(typeMap[TYPE_FLAT]) ? typeMap[TYPE_FLAT].map(String).filter(Boolean) : [];
  const foodIds   = Array.isArray(typeMap[TYPE_FOOD]) ? typeMap[TYPE_FOOD].map(String).filter(Boolean) : [];

  try {
    const [
      adhyanBookingDetailsFromDb,
      travelBookingDetails,
      roomBookingDetails,
      utsavBookingDetails,
      flatBookingDetails,
      foodBookingDetails
    ] = await Promise.all([
      adhyanIds.length
        ? ShibirBookingDb.findAll({
            where: { bookingid: { [Op.in]: adhyanIds } },
            include: [{ model: ShibirDb, as: 'ShibirDb' }],
            order: [['cardno', 'ASC'], ['createdAt', 'ASC']]
          })
        : [],
      travelIds.length
        ? TravelDb.findAll({ where: { bookingid: { [Op.in]: travelIds } } })
        : [],
      roomIds.length
        ? RoomBooking.findAll({
            where: { bookingid: { [Op.in]: roomIds } },
            order: [['cardno', 'ASC'], ['checkin', 'ASC']]
          })
        : [],
      utsavIds.length
        ? UtsavBooking.findAll({
            where: { bookingid: { [Op.in]: utsavIds } },
            include: [
              { model: UtsavDb, as: 'UtsavDb' },
              { model: UtsavPackagesDb, as: 'UtsavPackagesDb' }
            ],
            order: [['cardno', 'ASC'], ['createdAt', 'ASC']]
          })
        : [],
      flatIds.length
        ? FlatBooking.findAll({ where: { bookingid: { [Op.in]: flatIds } } })
        : [],
      foodIds.length
        ? FoodDb.findAll({
            where: { id: { [Op.in]: foodIds } },
            order: [['cardno', 'ASC'], ['date', 'ASC']]
          })
        : []
    ]);

    // Synthesize missing adhyan entries
    const requested = adhyanIds.map(String);
    const foundIds = new Set((adhyanBookingDetailsFromDb || []).map((r) => String(r.bookingid || r.bookingId || r.id)));
    const missing = requested.filter(id => !foundIds.has(id));
    const synthesized = missing.map(id => ({ bookingid: id, cardno, status: 'pending', ShibirDb: null }));
    const adhyanBookingDetails = [...(adhyanBookingDetailsFromDb || []), ...synthesized];

    return {
      adhyanBookingDetails,
      travelBookingDetails,
      roomBookingDetails,
      utsavBookingDetails,
      flatBookingDetails,
      foodBookingDetails
    };
  } catch (err) {
    console.error(`WA DIAG: fetchFreshDetailsForCard(${cardno}) failed:`, err && (err.stack || err.message || err));
    return {
      adhyanBookingDetails: [],
      travelBookingDetails: [],
      roomBookingDetails: [],
      utsavBookingDetails: [],
      flatBookingDetails: [],
      foodBookingDetails: []
    };
  }
}

export const guestBooking = async (req, res) => {
  attachUserContext(req);
  const { primary_booking, addons } = req.body;
  req.log.info('guest_booking_start', {
    cardno: req.user.cardno,
    primaryBookingType: primary_booking?.booking_type,
    addonCount: addons?.length || 0
  });

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
    req.log.info('guest_booking_creating_order', { cardno: req.user.cardno, amount });
    order = await generateOrderId(amount);
    const bookingIds = retrieveBookingIds(userBookingIdMap);
    await updateRazorpayTransactions(bookingIds, transactionIds, order.id, t);
    req.log.info('guest_booking_order_created', { cardno: req.user.cardno, orderId: order.id, amount });
  }

  await t.commit();
  req.log.info('guest_booking_committed', { cardno: req.user.cardno });

  // --- WhatsApp notifications ---
  try {
    const bookedByCard = req.user.cardno;
    const allCardnos = Object.keys(userBookingIdMap || {});
    const jobs = [];

    for (const cardno of allCardnos) {
      const details = await fetchFreshDetailsForCard(cardno, userBookingIdMap);

      jobs.push(sendUnifiedWhatsApp(
        cardno,
        details.adhyanBookingDetails,
        details.travelBookingDetails,
        details.flatBookingDetails,
        details.utsavBookingDetails,
        details.roomBookingDetails,
        null,
        details.foodBookingDetails
      ));

      if (cardno !== bookedByCard) {
        jobs.push(sendUnifiedWhatsApp(
          bookedByCard,
          details.adhyanBookingDetails,
          details.travelBookingDetails,
          details.flatBookingDetails,
          details.utsavBookingDetails,
          details.roomBookingDetails,
          cardno,
          details.foodBookingDetails
        ));
      }
    }

    const results = await Promise.allSettled(jobs);
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`WhatsApp job #${i} failed:`, r.reason);
      } else {
        console.log(`WhatsApp job #${i} succeeded`);
      }
    });
  } catch (waErr) {
    console.error("Unexpected error in WhatsApp notification block:", waErr);
    // do not rollback here — WhatsApp failures are non-fatal for the booking flow
  }

  // Sending email to logged in user for self or other mumkshus
  sendUnifiedEmailForBookedBy(
    userBookingIdMap,
    req.user,
    BOOKING_STATUS_PENDING,
    false
  );
  for (const cardno in userBookingIdMap) {
    if (cardno != req.user.cardno) {
      const bookings = userBookingIdMap[cardno];
      //Sending email to other mumkshu & Guest
      sendUnifiedEmail(
        cardno,
        bookings,
        req.user,
        BOOKING_STATUS_PENDING,
        'unifiedBookingEmail',
        false
      );
    }
  }
  let message = MSG_BOOKING_SUCCESSFUL;
  if (Object.keys(waitingBookingCountMap).length > 0) {
    message = MSG_BOOKING_WAITING;
    req.log.info('guest_booking_waiting', {
      cardno: req.user.cardno,
      waitingBookingCountMap
    });
  }
  req.log.info('guest_booking_success', {
    cardno: req.user.cardno,
    totalAmount: amount,
    orderId: order?.id,
    message
  });
  return res.status(200).send({
    message: message,
    data: order ? order : { amount: 0 },
    waitingBookingCountMap: waitingBookingCountMap
  });
};

export const validateBooking = async (req, res) => {
  attachUserContext(req);
  const { primary_booking, addons } = req.body;
  req.log.info('validate_guest_booking_start', {
    cardno: req.user.cardno,
    primaryBookingType: primary_booking?.booking_type,
    addonCount: addons?.length || 0
  });

  const response = {
    roomDetails: [],
    flatDetails: [],
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

  req.log.info('validate_guest_booking_success', {
    cardno: req.user.cardno,
    totalCharge: response.totalCharge
  });
  return res.status(200).send({ data: response });
};

async function book(
  body,
  data,
  t,
  user,
  utsav,
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
      setBookingIdMap(userBookingIdMap, TYPE_FOOD, foodResult.userBookingIds);
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
  attachUserContext(req);
  req.log.warn('guest_booking_flat_deprecated', {
    cardno: req.user.cardno,
    message: 'guestBookingFlat endpoint is deprecated. Use unified booking endpoint instead.'
  });

  const { guests, startDay, endDay } = req.body;
  req.log.info('guest_booking_flat_start', {
    cardno: req.user.cardno,
    startDay,
    endDay,
    guestCount: guests?.length
  });

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
  req.log.info('guest_booking_flat_committed', {
    cardno: req.user.cardno,
    orderId: order?.id,
    amount: order?.amount
  });

  const userBookingIdMap = {};
  for (const cardno in userBookingIds) {
    userBookingIdMap[cardno] = {
      [TYPE_FLAT]: userBookingIds[cardno]
    };
  }

  // --- WhatsApp notifications ---
  try {
    const bookedByCard = req.user.cardno;
    const allCardnos = Object.keys(userBookingIdMap || {});
    const jobs = [];

    for (const cardno of allCardnos) {
      const details = await fetchFreshDetailsForCard(cardno, userBookingIdMap);

      jobs.push(sendUnifiedWhatsApp(
        cardno,
        details.adhyanBookingDetails,
        details.travelBookingDetails,
        details.flatBookingDetails,
        details.utsavBookingDetails,
        details.roomBookingDetails,
        null,
        details.foodBookingDetails
      ));

      if (cardno !== bookedByCard) {
        jobs.push(sendUnifiedWhatsApp(
          bookedByCard,
          details.adhyanBookingDetails,
          details.travelBookingDetails,
          details.flatBookingDetails,
          details.utsavBookingDetails,
          details.roomBookingDetails,
          cardno,
          details.foodBookingDetails
        ));
      }
    }

    const results = await Promise.allSettled(jobs);
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`WhatsApp job #${i} failed:`, r.reason);
      } else {
        console.log(`WhatsApp job #${i} succeeded`);
      }
    });
  } catch (waErr) {
    console.error("Unexpected error in WhatsApp notification block:", waErr);
    // do not rollback here — WhatsApp failures are non-fatal for the booking flow
  }

  sendUnifiedEmailForBookedBy(
    userBookingIdMap,
    req.user,
    BOOKING_STATUS_PENDING,
    false
  );

  Object.entries(userBookingIds)
    .filter(([cardno]) => cardno !== req.user.cardno) // Filter out the current user's cardno
    .forEach(([cardno, bookings]) => {
      sendUnifiedEmail(
        cardno,
        { [TYPE_FLAT]: bookings },
        req.user,
        BOOKING_STATUS_PENDING,
        'unifiedBookingEmail',
        false
      );
    });

  req.log.info('guest_booking_flat_success', {
    cardno: req.user.cardno,
    orderId: order?.id,
    amount: order?.amount
  });
  return res.status(200).send({
    message: MSG_BOOKING_SUCCESSFUL,
    data: order
  });
};

export const fetchGuests = async (req, res) => {
  attachUserContext(req);
  const { cardno } = req.user;
  req.log.info('fetch_guests_start', { cardno });

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

  req.log.info('fetch_guests_success', { cardno, count: guests.length });
  return res.status(200).send({
    message: 'fetched results',
    data: guests
  });
};

export const createGuests = async (req, res) => {
  attachUserContext(req);
  const { cardno } = req.user;
  const { guests } = req.body;
  req.log.info('create_guests_start', { cardno, guestCount: guests?.length });

  const t = await database.transaction();
  req.transaction = t;

  const allGuests = await createGuestsHelper(cardno, guests, t);

  await t.commit();
  req.log.info('create_guests_success', { cardno, createdCount: allGuests?.length });

  // --- Send WhatsApp notification to newly created guests ---
  const newlyCreatedGuests = allGuests.filter((guest) => {
    const wasRegistered = guests.some((g) => g.cardno === guest.cardno);
    return !wasRegistered;
  });

  for (const newGuest of newlyCreatedGuests) {
    const phone = newGuest.mobno;
    if (phone) {
      try {
        const formattedPhone = formatWhatsAppPhone(phone, newGuest.country);

        const components = [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: newGuest.issuedto || 'Mumukshu' },
              { type: 'text', text: newGuest.cardno }
            ]
          }
        ];

        await sendWhatsAppMessage(formattedPhone, 'card_account_created', components);
      } catch (waErr) {
        console.error('Error sending WhatsApp message in createGuests:', waErr.message || waErr);
      }
    }
  }

  return res.status(200).send({
    message: MSG_UPDATE_SUCCESSFUL,
    guests: allGuests
  });
};

export const checkGuests = async (req, res) => {
  const { mobno } = req.params;
  req.log.info('check_guests_start', { mobno });

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
    req.log.info('check_guests_not_found', { mobno });
    return res.status(200).send({ message: 'Guest not found', data: null });
  }

  if (user.res_status == STATUS_GUEST) {
    req.log.info('check_guests_found', { mobno, cardno: user.cardno });
    return res.status(200).send({ message: 'Guest found', data: user });
  } else {
    req.log.warn('check_guests_not_a_guest', { mobno, cardno: user.cardno, resStatus: user.res_status });
    throw new ApiError(401, 'User is not a guest');
  }
};

async function bookFlat(data, t, user) {
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
