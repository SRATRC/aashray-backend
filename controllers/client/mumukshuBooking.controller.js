// add this near other sequelize imports
// at top of both files (whatsapp.helper and mumukshuBooking.controller)
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
  STATUS_AWAITING_CONFIRMATION,
  BOOKING_STATUS_PENDING,
  STATUS_SEVA_KUTIR,
  RESEARCH_CENTRE,
  TYPE_FLAT
} from '../../config/constants.js';
import {
  bookRoomForMumukshus,
  checkRoomAvailabilityForMumukshus,
  bookFlatForMumukshus,
  roomCharge
} from '../../helpers/roomBooking.helper.js';
// import { UtsavDb } from '../../models/associations.js';
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
  validateUtsavs
} from '../../helpers/utsavBooking.helper.js';
// import { CardDb } from '../../models/associations.js';
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
  setWaitingBookingCountMap,
  calculateNights,
  validateDate,
  checkFlatAlreadyBooked
} from '../helper.js';
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

// export const mumukshuBooking = async (req, res) => {
//   const { primary_booking, addons } = req.body;
//   var t = await database.transaction();
//   req.transaction = t;

//   const userBookingIdMap = {};
//   const waitingBookingCountMap = {};
//   let amount = await book(
//     req.body,
//     primary_booking,
//     t,
//     req.user,
//     userBookingIdMap,
//     waitingBookingCountMap
//   );

//   if (addons) {
//     for (const addon of addons) {
//       amount += await book(
//         req.body,
//         addon,
//         t,
//         req.user,
//         userBookingIdMap,
//         waitingBookingCountMap
//       );
//     }
//   }

//   var order = null;
//   if (req.user.country == 'India' && amount > 0) {
//     order = await generateOrderId(amount);
//     const bookingIds = retrieveBookingIds(userBookingIdMap);
//     await updateRazorpayTransactions(bookingIds, [], order.id, t);
//   }
//   await t.commit();
  
//   console.log(userBookingIdMap);
//   // ------------------ WHATSAPP NOTIFICATIONS ------------------
// // ------------------ WHATSAPP NOTIFICATIONS (VERBOSE DIAGNOSTICS) ------------------
// try {
//   const bookedByCard = req.user.cardno;
//   const allCardnos = Object.keys(userBookingIdMap || {});

//   console.log("WA DIAG: userBookingIdMap =", JSON.stringify(userBookingIdMap));
//   console.log("WA DIAG: bookedByCard =", bookedByCard, "allCardnos =", allCardnos);

  

//   const jobs = [];
//   let jobIndex = 0;

//   for (const cardno of allCardnos) {
//     const details = await fetchFreshDetailsForCard(cardno, userBookingIdMap);


//     console.log(`WA DIAG: scheduling sendUnifiedWhatsApp -> recipient=${cardno} bookedFor=null adhyan=${(details.adhyanBookingDetails||[]).length}`);
//     jobs.push(
//       (async () => sendUnifiedWhatsApp(
//         cardno,
//         details.adhyanBookingDetails,
//         details.travelBookingDetails,
//         details.flatBookingDetails,
//         details.utsavBookingDetails,
//         details.roomBookingDetails,
//         null
//       ))()
//     );
//     jobIndex++;

//     if (cardno !== bookedByCard) {
//       console.log(`WA DIAG: scheduling sendUnifiedWhatsApp -> recipient=${bookedByCard} bookedFor=${cardno} adhyan=${(details.adhyanBookingDetails||[]).length}`);
//       jobs.push(
//         (async () => sendUnifiedWhatsApp(
//           bookedByCard,
//           details.adhyanBookingDetails,
//           details.travelBookingDetails,
//           details.flatBookingDetails,
//           details.utsavBookingDetails,
//           details.roomBookingDetails,
//           cardno
//         ))()
//       );
//       jobIndex++;
//     }
//   }

//   console.log(`WA DIAG: total jobs scheduled = ${jobs.length}`);

//   const results = await Promise.allSettled(jobs);
//   results.forEach((r, i) => {
//     if (r.status === 'rejected') {
//       console.error(`WhatsApp job #${i} failed:`, r.reason);
//     } else {
//       console.log(`WhatsApp job #${i} succeeded`);
//     }
//   });
// } catch (err) {
//   console.error("Unexpected error in WhatsApp notification block:", err);
// }
// // ------------------------------------------------------------------------------------
  
//   //Sending email to logged in user for self or other mumkshus
//   sendUnifiedEmailForBookedBy(
//     userBookingIdMap,
//     req.user,
//     BOOKING_STATUS_PENDING
//   );
//   for (const cardno in userBookingIdMap) {
//     if (cardno != req.user.cardno) {
//       const bookings = userBookingIdMap[cardno];
//       //Sending email to other mumkshu & Guest
//       sendUnifiedEmail(cardno, bookings, req.user, BOOKING_STATUS_PENDING);
//     }
//   }
//   let message =
//     Object.keys(waitingBookingCountMap).length > 0
//       ? MSG_BOOKING_WAITING
//       : MSG_BOOKING_SUCCESSFUL;

//   return res.status(200).send({
//     message: message,
//     order: order ? order : { amount: 0 },
//     waitingBookingCountMap
//   });
// };

export const validateBooking = async (req, res) => {
  const { primary_booking, addons } = req.body;

  const response = {
    roomDetails: [],
    flatDetails: [],
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
      const flatResult = await bookFlatForMumukshus(
        data.details.checkin_date || data.details.startDay,
        data.details.checkout_date || data.details.endDay,
        data.details.mumukshus || data.details.guests,
        user,
        t
      );
      amount += flatResult.order.amount;
      setBookingIdMap(userBookingIdMap, TYPE_FLAT, flatResult.userBookingIds);
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
      response.foodDetails = await checkFoodAvailability(body, data, user, utsav);
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
      response.flatDetails = await checkFlatAvailability(data);
      const nights = await calculateNights(data.details.checkin_date, data.details.checkout_date);
      totalCharge += roomCharge('nac') * nights * (data.details.mumukshus || data.details.guests).length;
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

async function checkFlatAvailability(data) {
  const { checkin_date, checkout_date, mumukshus, guests } = data.details;
  const list = mumukshus || guests || [];
  validateDate(checkin_date, checkout_date);

  const flatDetails = [];
  const nights = await calculateNights(checkin_date, checkout_date);
  const chargePerGuest = roomCharge('nac') * nights;

  for (const person of list) {
    const isAlreadyBooked = await checkFlatAlreadyBooked(checkin_date, checkout_date, person);
    if (isAlreadyBooked) {
      throw new ApiError(400, `Flat already booked for ${person}`);
    }

    flatDetails.push({
      mumukshu: person,
      status: 'available',
      charge: chargePerGuest
    });
  }

  return flatDetails;
}

async function getBookingDetailsForCard(cardno, userBookingIdMap) {
  const typeMap = userBookingIdMap[cardno] || {};

  const adhyanIds = typeMap[TYPE_ADHYAYAN] || [];
  const travelIds = typeMap[TYPE_TRAVEL] || [];
  const roomIds   = typeMap[TYPE_ROOM] || [];
  const utsavIds  = typeMap[TYPE_UTSAV] || [];
  const flatIds   = typeMap[TYPE_FLAT] || []; // if used later
  

  const [
    adhyanBookingDetails,
    travelBookingDetails,
    roomBookingDetails,
    utsavBookingDetails,
    flatBookingDetails
  ] = await Promise.all([
    adhyanIds.length
      ? ShibirBookingDb.findAll({
          where: { bookingid: { [Op.in]: adhyanIds } },
          include: [{ model: ShibirDb, as: "ShibirDb" }]
        })
      : [],
    travelIds.length
      ? TravelDb.findAll({ where: { bookingid: { [Op.in]: travelIds } } })
      : [],
    roomIds.length
      ? RoomBooking.findAll({ where: { bookingid: { [Op.in]: roomIds } } })
      : [],
    utsavIds.length
      ? UtsavBooking.findAll({ where: { bookingid: { [Op.in]: utsavIds } } })
      : [],
    flatIds.length
      ? FlatBooking.findAll({ where: { bookingid: { [Op.in]: flatIds } } })
      : []
  ]);

  return {
    adhyanBookingDetails,
    travelBookingDetails,
    roomBookingDetails,
    utsavBookingDetails,
    flatBookingDetails
  };
}
