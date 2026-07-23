import { Op } from 'sequelize';
import {
  TYPE_ROOM,
  TYPE_FOOD,
  TYPE_ADHYAYAN,
  ERR_INVALID_BOOKING_TYPE,
  ERR_CARD_NOT_FOUND,
  TYPE_TRAVEL,
  ERR_INVALID_DATE,
  MSG_BOOKING_SUCCESSFUL,
  MSG_BOOKING_WAITING,
  STATUS_RESIDENT,
  STATUS_MUMUKSHU,
  TYPE_UTSAV,
  TYPE_FLAT,
  STATUS_AWAITING_CONFIRMATION,
  BOOKING_STATUS_PENDING,
  STATUS_SEVA_KUTIR,
  RESEARCH_CENTRE
} from '../../config/constants.js';
import {
  bookRoomForMumukshus,
  checkRoomAvailabilityForMumukshus,
  bookFlatForMumukshus,
  checkFlatAvailabilityForMumukshus
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
  checkFoodAvailabilityForMumumkshus
} from '../../helpers/foodBooking.helper.js';
import {
  bookUtsavForMumukshus,
  validateUtsavs,
  validateNoDuplicateUtsavBooking
} from '../../helpers/utsavBooking.helper.js';
import { validateCards } from '../../helpers/card.helper.js';
import {
  generateOrderId,
  updateRazorpayTransactions
} from '../../helpers/transactions.helper.js';
import {
  setBookingIdMap,
  retrieveBookingIds,
  sendUnifiedEmailForBookedBy,
  sendUnifiedEmail,
  setWaitingBookingCountMap
} from '../helper.js';
import { attachUserContext } from '../../middleware/Logger.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import moment from 'moment';
import {
  ShibirBookingDb,
  TravelDb,
  RoomBooking,
  UtsavBooking,
  FlatBooking,
  ShibirDb,
  UtsavDb,
  UtsavPackagesDb,
  Transactions,
  CardDb,
  FoodDb
} from "../../models/associations.js";
import { sendUnifiedWhatsApp } from "../../helpers/whatsapp.helper.js";

// top-level helper: accepts the userBookingIdMap explicitly

async function fetchFreshDetailsForCard(cardno, userBookingIdMap) {
  const typeMap = userBookingIdMap[cardno] || {};
  const adhyanIds = Array.isArray(typeMap[TYPE_ADHYAYAN]) ? typeMap[TYPE_ADHYAYAN].map(String).filter(Boolean) : [];
  const travelIds = Array.isArray(typeMap[TYPE_TRAVEL]) ? typeMap[TYPE_TRAVEL].map(String).filter(Boolean) : [];
  const roomIds   = Array.isArray(typeMap[TYPE_ROOM]) ? typeMap[TYPE_ROOM].map(String).filter(Boolean) : [];
  const utsavIds  = Array.isArray(typeMap[TYPE_UTSAV]) ? typeMap[TYPE_UTSAV].map(String).filter(Boolean) : [];
  const flatIds   = Array.isArray(typeMap[TYPE_FLAT]) ? typeMap[TYPE_FLAT].map(String).filter(Boolean) : [];
  const foodIds   = Array.isArray(typeMap[TYPE_FOOD]) ? typeMap[TYPE_FOOD].map(String).filter(Boolean) : [];

  console.log(`WA DIAG: fetchFreshDetailsForCard(${cardno}) adhyanIds=${JSON.stringify(adhyanIds)} roomIds=${JSON.stringify(roomIds)} utsavIds=${JSON.stringify(utsavIds)} foodIds=${JSON.stringify(foodIds)}`);

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
    if (missing.length) {
      console.log(`WA DIAG: synthesize missing adhyan ids for ${cardno}:`, missing);
    }
    const synthesized = missing.map(id => ({ bookingid: id, cardno, status: 'pending', ShibirDb: null }));
    const adhyanBookingDetails = [...(adhyanBookingDetailsFromDb || []), ...synthesized];

    console.log(`WA DIAG: final adhyanBookingDetails[${cardno}] length=${adhyanBookingDetails.length} roomCount=${(roomBookingDetails||[]).length} utsavCount=${(utsavBookingDetails||[]).length} foodCount=${(foodBookingDetails||[]).length}`);

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


export const validateBooking = async (req, res) => {
  attachUserContext(req);
  const { primary_booking, addons } = req.body;

  // A member can hold only one booking per utsav — reject if the same utsav is
  // selected more than once for the same person across primary + addons, so the
  // user is blocked here before proceeding to payment.
  validateNoDuplicateUtsavBooking(primary_booking, addons);

  req.log.info('validate_mumukshu_booking_start', {
    cardno: req.user.cardno,
    primaryBookingType: primary_booking?.booking_type,
    addonCount: addons?.length || 0
  });

  const response = {
    roomDetails: [],
    flatDetails: [],
    adhyayanDetails: [],
    foodDetails: {},
    travelDetails: {},
    utsavDetails: [],
    flatDetails: [],
    totalCharge: 0
  };

  let utsav = null;
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

  req.log.info('validate_mumukshu_booking_success', {
    cardno: req.user.cardno,
    totalCharge: response.totalCharge
  });
  return res.status(200).send({ data: response });
};

export const mumukshuBooking = async (req, res, next) => {
  let t;
  try {
    const { primary_booking, addons } = req.body;
    t = await database.transaction();
    req.transaction = t;

    const userBookingIdMap = {};
    const waitingBookingCountMap = {};
    let amount = await book(
      req.body,
      primary_booking,
      t,
      req.user,
      null,
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
          null,
          userBookingIdMap,
          waitingBookingCountMap
        );
      }
    }

    let order = null;
    if (req.user.country == 'India' && amount > 0) {
      order = await generateOrderId(amount);
      const bookingIds = retrieveBookingIds(userBookingIdMap);
      await updateRazorpayTransactions(bookingIds, [], order.id, t);
    }

    await t.commit();

    // --- WhatsApp notifications (your existing block) ---
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

    // Emails (unchanged)
    sendUnifiedEmailForBookedBy(
      userBookingIdMap,
      req.user,
      BOOKING_STATUS_PENDING,
      false
    );
    for (const cardno in userBookingIdMap) {
      if (cardno != req.user.cardno) {
        const bookings = userBookingIdMap[cardno];
        sendUnifiedEmail(cardno, bookings, req.user, BOOKING_STATUS_PENDING, 'unifiedBookingEmail', false);
      }
    }

    const message =
      Object.keys(waitingBookingCountMap).length > 0
        ? MSG_BOOKING_WAITING
        : MSG_BOOKING_SUCCESSFUL;

    return res.status(200).send({
      message,
      order: order ? order : { amount: 0 },
      waitingBookingCountMap
    });
  } catch (err) {
    console.error("mumukshuBooking failed:", err && (err.stack || err.message || err));
    // rollback if transaction started
    if (t && !t.finished) {
      try {
        await t.rollback();
        console.info("Transaction rolled back due to error.");
      } catch (rbErr) {
        console.error("Transaction rollback failed:", rbErr);
      }
    }
    // pass to express error middleware
    if (typeof next === "function") return next(err);
    // otherwise send generic 500
    return res.status(500).send({ message: "Internal Server Error", error: String(err && err.message) });
  }
};


export const checkMumukshuOrGuest = async (req, res) => {
  const { mobno } = req.query;
  req.log.info('check_mumukshu_or_guest_start', { mobno });

  const cardDb = await CardDb.findOne({
    where: {
      mobno: mobno
    },
    attributes: ['cardno', 'issuedto', 'mobno', 'gender', 'res_status']
  });

  if (!cardDb) {
    req.log.warn('check_mumukshu_or_guest_not_found', { mobno });
    throw new ApiError(404, ERR_CARD_NOT_FOUND);
  }

  if (
    ![STATUS_RESIDENT, STATUS_MUMUKSHU, STATUS_SEVA_KUTIR].includes(
      cardDb.res_status
    )
  ) {
    req.log.warn('check_mumukshu_or_guest_not_mumukshu', {
      mobno,
      cardno: cardDb.cardno,
      resStatus: cardDb.res_status
    });
    throw new ApiError(401, 'User is not a mumukshu');
  }

  req.log.info('check_mumukshu_or_guest_success', { mobno, cardno: cardDb.cardno, resStatus: cardDb.res_status });
  return res.status(200).send({ data: cardDb });
};

async function book(
  body,
  data,
  t,
  user,
  utsav,
  userBookingIdMap,
  waitingBookingCountMap
) {
  let amount = 0;

  switch (data.booking_type) {
    case TYPE_ROOM:
      const roomResult = await bookRoom(body, data, t, user, utsav);
      amount += roomResult.amount;
      setBookingIdMap(userBookingIdMap, TYPE_ROOM, roomResult.userBookingIds);
      break;

    case TYPE_FOOD:
      const foodResult = await bookFood(body, data, t, user);
      setBookingIdMap(userBookingIdMap, TYPE_FOOD, foodResult.userBookingIds);
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

    case TYPE_FLAT:
      const flatResult = await bookFlat(body, data, t, user);
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

async function bookRoom(body, data, t, user, utsav) {
  const { checkin_date, checkout_date, mumukshuGroup } = data.details;
  const extra_stay_reason = body?.extra_stay_reason || data?.extra_stay_reason || data?.details?.extra_stay_reason || null;
  const result = await bookRoomForMumukshus(
    checkin_date,
    checkout_date,
    mumukshuGroup,
    t,
    user,
    utsav,
    logger,
    extra_stay_reason
  );
  return result;
}

async function bookFlat(body, data, t, user) {
  const { checkin_date, checkout_date, mumukshus } = data.details;

  if (!checkout_date) {
    throw new ApiError(400, 'checkout date is required for flat booking');
  }

  const extra_stay_reason = body?.extra_stay_reason || data?.extra_stay_reason || data?.details?.extra_stay_reason || null;

  const result = await bookFlatForMumukshus(
    checkin_date,
    checkout_date,
    mumukshus,
    user,
    t,
    false,
    logger,
    extra_stay_reason
  );
  return {
    amount: result.amount,
    userBookingIds: result.userBookingIds
  };
}

async function bookFood(body, data, t, user) {
  let { start_date, end_date, mumukshuGroup } = data.details;
  const result = await bookFoodForMumukshus(
    start_date,
    end_date,
    mumukshuGroup,
    body.primary_booking,
    body.addons,
    user.cardno,
    t,
    user.cardno
  );

  return result;
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
  const result = await checkRoomAvailabilityForMumukshus(
    checkin_date,
    checkout_date,
    mumukshuGroup,
    user,
    utsav
  );

  return result;
}

async function checkFoodAvailability(body, data, user, utsav) {
  let { start_date, end_date, mumukshuGroup } = data.details;

  const result = await checkFoodAvailabilityForMumumkshus(
    start_date,
    end_date,
    mumukshuGroup,
    body.primary_booking,
    body.addons,
    utsav,
    user
  );

  return result;
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

async function checkFlatAvailability(data, user) {
  const { checkin_date, checkout_date, mumukshus } = data.details;

  if (!checkout_date) {
    throw new ApiError(400, 'checkout_date is required for flat booking');
  }

  const result = await checkFlatAvailabilityForMumukshus(
    checkin_date,
    checkout_date,
    mumukshus,
    user
  );
  return result;
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

// (removed unused getBookingDetailsForCard — superseded by fetchFreshDetailsForCard)
