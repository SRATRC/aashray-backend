import {
  STATUS_WAITING,
  STATUS_AVAILABLE,
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_PENDING_CHECKIN,
  ERR_ROOM_FAILED_TO_BOOK,
  NAC_ROOM_PRICE,
  AC_ROOM_PRICE,
  TYPE_ROOM,
  ERR_ROOM_NO_BED_AVAILABLE,
  ERR_ROOM_ALREADY_BOOKED,
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED,
  TYPE_FLAT,
  STATUS_PAYMENT_PENDING,
  ERR_FLAT_FAILED_TO_BOOK,
  ERR_FLAT_ALREADY_BOOKED,
  HOLD_REASON,
  ROLLING_WINDOW_NIGHT_LIMIT,
  RESEARCH_CENTRE
} from '../config/constants.js';
import {
  RoomBooking,
  RoomDb,
  FlatBooking,
  FlatDb,
  UtsavDb
} from '../models/associations.js';
import {
  createPendingTransaction,
  generateOrderId,
  updateRazorpayTransactions,
  usableCredits
} from './transactions.helper.js';
import moment from 'moment';
import {
  calculateNights,
  checkFlatAlreadyBooked,
  validateDate,
  getBlockedDates,
  isBlockFromUtsav,
  isDateBlocked
} from '../controllers/helper.js';
import {
  findUtsavOnBoundaryDates,
  getDateRangesDuringUtsav
} from './utsavBooking.helper.js';
import { v4 as uuidv4 } from 'uuid';
import { validateCards } from './card.helper.js';
import {
  checkRollingWindowLimitBatch,
  checkRollingWindowLimitForCards,
  rollingWaitlistFields
} from './rollingWindow.helper.js';
import Sequelize from 'sequelize';
import ApiError from '../utils/ApiError.js';
import logger from '../config/logger.js';

// A room booking always names who is staying — reject early with a clear 400
// instead of crashing on `undefined.flatMap` deeper in the booking flow.
function requireMumukshuGroup(mumukshuGroup) {
  if (!Array.isArray(mumukshuGroup) || mumukshuGroup.length === 0) {
    throw new ApiError(400, 'mumukshuGroup is required for a room booking');
  }
}

// Room bookings held by these cards that overlap [checkin, checkout), grouped by
// cardno. The preview path needs WHICH card clashes and on WHAT dates so it can
// name the clash per person, instead of failing the whole request with one
// message. checkRoomAlreadyBooked keeps its boolean contract on top of this.
export async function getOverlappingRoomBookings(checkin, checkout, cardnos, transaction = null) {
  const queryCheckout = checkin === checkout
    ? moment(checkin).add(1, 'day').format('YYYY-MM-DD')
    : checkout;

  const result = await RoomBooking.findAll({
    attributes: ['cardno', 'checkin', 'checkout', 'nights', 'status'],
    where: {
      [Sequelize.Op.or]: [
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.gte]: checkin } },
            { checkin: { [Sequelize.Op.lt]: queryCheckout } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkout: { [Sequelize.Op.gt]: checkin } },
            { checkout: { [Sequelize.Op.lte]: queryCheckout } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.lte]: checkin } },
            { checkout: { [Sequelize.Op.gte]: queryCheckout } }
          ]
        }
      ],
      cardno: cardnos,
      status: [
        STATUS_WAITING,
        STATUS_PAYMENT_PENDING,
        ROOM_STATUS_CHECKEDIN,
        ROOM_STATUS_PENDING_CHECKIN
      ]
    },
    transaction
  });

  const byCard = {};
  for (const booking of result) {
    const key = String(booking.cardno);
    if (!byCard[key]) byCard[key] = [];
    byCard[key].push(booking);
  }
  return byCard;
}

export async function checkRoomAlreadyBooked(checkin, checkout, ...cardnos) {
  const result = await RoomBooking.findAll({
    where: {
      [Sequelize.Op.or]: [
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.gte]: checkin } },
            { checkin: { [Sequelize.Op.lt]: checkout } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkout: { [Sequelize.Op.gt]: checkin } },
            { checkout: { [Sequelize.Op.lte]: checkout } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.lte]: checkin } },
            { checkout: { [Sequelize.Op.gte]: checkout } }
          ]
        }
      ],
      cardno: cardnos,
      status: [
        STATUS_WAITING,
        STATUS_PAYMENT_PENDING,
        ROOM_STATUS_CHECKEDIN,
        ROOM_STATUS_PENDING_CHECKIN
      ]
    }
  });

  return result.length > 0;
}

export async function bookDayVisit(
  cardno,
  checkin,
  checkout,
  bookedBy,
  updatedBy,
  t
) {
  const booking = await RoomBooking.create(
    {
      bookingid: uuidv4(),
      cardno,
      checkin,
      checkout,
      roomno: 'NA',
      roomtype: 'NA',
      gender: 'NA',
      nights: 0,
      status: ROOM_STATUS_PENDING_CHECKIN,
      bookedBy,
      updatedBy
    },
    { transaction: t }
  );

  if (!booking) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }
  return booking;
}

async function bookWaitingRoom(
  cardno,
  checkin,
  checkout,
  nights,
  roomtype,
  gender,
  bookedBy,
  updatedBy,
  t,
  holdReason,
  holdReasonMeta = null
) {
  const bookingId = uuidv4();
  await RoomBooking.create(
    {
      bookingid: bookingId,
      roomno: 'NA',
      status: STATUS_WAITING,
      cardno,
      bookedBy,
      checkin,
      checkout,
      nights,
      roomtype,
      gender,
      updatedBy,
      hold_reason: holdReason,
      hold_reason_meta: holdReasonMeta
    },
    { transaction: t }
  );
  return { t, discountedAmount: 0, bookingId, bookedRoomNo: 'NA' };
}

async function bookAvailableRoom(
  cardno,
  checkin,
  checkout,
  nights,
  roomno,
  roomtype,
  gender,
  bookedBy,
  user,
  cashAllowed = false,
  t
) {
  const bookingId = uuidv4();
  const updatedBy = user.cardno;
  const booking = await RoomBooking.create(
    {
      bookingid: bookingId,
      roomno,
      status: STATUS_PAYMENT_PENDING,
      cardno,
      bookedBy,
      checkin,
      checkout,
      nights,
      roomtype,
      gender,
      updatedBy
    },
    { transaction: t }
  );

  if (!booking) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }

  const amount = roomCharge(roomtype) * nights;

  const { transaction, discountedAmount } = await createPendingTransaction(
    user,
    booking,
    TYPE_ROOM,
    amount,
    updatedBy,
    t,
    cashAllowed
  );

  if (!transaction) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }

  return { t, discountedAmount, bookingId, bookedRoomNo: roomno };
}

export async function getPriorityOrderForMonth(checkinDate) {
  const defaultList = ['OAG_1st', 'OAG_2nd', 'NAG_1st', 'NAG_2nd'];
  try {
    const parsed = checkinDate
      ? moment(checkinDate, ['YYYY-MM-DD', 'DD-MM-YYYY', 'YYYY/MM/DD', 'DD/MM/YYYY'])
      : null;
    const monthNum = parsed && parsed.isValid() ? parsed.month() + 1 : null;
    let rec = null;
    if (monthNum) {
      rec = await RoomAllocationPriority.findOne({ where: { month: monthNum } });
    }
    if (!rec) {
      rec = await RoomAllocationPriority.findOne({ where: { month: null } });
    }
    if (!rec || !rec.priority_order) {
      return defaultList;
    }
    const list = rec.priority_order.split(',').map((s) => s.trim()).filter(Boolean);
    return list.length > 0 ? list : defaultList;
  } catch (err) {
    logger.warn('get_priority_order_failed', { checkinDate, error: err.message });
    return defaultList;
  }
}

function buildPriorityOrderClause(priorityList, isGroundPref = false) {
  let orderedList = [...priorityList];

  if (isGroundPref) {
    const firstFloor = priorityList.filter((item) => item.endsWith('_1st'));
    const secondFloor = priorityList.filter((item) => item.endsWith('_2nd'));
    orderedList = [...firstFloor, ...secondFloor];
  }

  const oag1Index = orderedList.indexOf('OAG_1st') !== -1 ? orderedList.indexOf('OAG_1st') + 1 : 99;
  const oag2Index = orderedList.indexOf('OAG_2nd') !== -1 ? orderedList.indexOf('OAG_2nd') + 1 : 99;
  const nag1Index = orderedList.indexOf('NAG_1st') !== -1 ? orderedList.indexOf('NAG_1st') + 1 : 99;
  const nag2Index = orderedList.indexOf('NAG_2nd') !== -1 ? orderedList.indexOf('NAG_2nd') + 1 : 99;

  const ROOMNO_SHAPE = "roomno REGEXP '^[0-9]+[A-Za-z]$'";
  return [
    Sequelize.literal(`
      CASE
        WHEN NOT (${ROOMNO_SHAPE}) THEN 99
        WHEN CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED) BETWEEN 1 AND 18 THEN ${oag1Index}
        WHEN CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED) BETWEEN 19 AND 36 THEN ${oag2Index}
        WHEN CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED) BETWEEN 37 AND 48 THEN ${nag1Index}
        WHEN CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED) BETWEEN 49 AND 60 THEN ${nag2Index}
        ELSE 99
      END ASC
    `),
    Sequelize.literal(`CASE WHEN ${ROOMNO_SHAPE} THEN CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED) ELSE 999999 END ASC`),
    Sequelize.literal('SUBSTRING(roomno, LENGTH(roomno)) ASC')
  ];
}

const gendersToTry = (gender) =>
  gender === 'SCM' ? ['SCM', 'M'] : gender === 'SCF' ? ['SCF', 'F'] : [gender];

async function fetchBlockedRoomnos(checkin, queryCheckout) {
  try {
    const blocks = await RoomBlock.findAll({
      attributes: ['roomno'],
      where: {
        status: 'active',
        start_date: { [Sequelize.Op.lt]: queryCheckout },
        [Sequelize.Op.or]: [
          { end_date: null },
          { end_date: { [Sequelize.Op.gte]: checkin } }
        ]
      }
    });
    return blocks.map((b) => b.roomno);
  } catch (err) {
    logger.warn('fetch_blocked_rooms_failed', { error: err.message });
    return [];
  }
}

export async function fetchActiveRoomBlocks(checkin, checkout) {
  try {
    const windowCheckout = checkin === checkout
      ? moment(checkin, ['YYYY-MM-DD', 'DD-MM-YYYY', 'YYYY/MM/DD', 'DD/MM/YYYY']).add(1, 'day').format('YYYY-MM-DD')
      : checkout;
    return await RoomBlock.findAll({
      attributes: ['roomno', 'start_date', 'end_date'],
      where: {
        status: 'active',
        start_date: { [Sequelize.Op.lt]: windowCheckout },
        [Sequelize.Op.or]: [
          { end_date: null },
          { end_date: { [Sequelize.Op.gte]: checkin } }
        ]
      }
    });
  } catch (err) {
    logger.warn('fetch_active_room_blocks_failed', { error: err.message });
    return [];
  }
}

export function blockedRoomsInRange(activeRoomBlocks, start, end) {
  if (!Array.isArray(activeRoomBlocks) || activeRoomBlocks.length === 0) return [];
  const rangeEnd = start === end
    ? moment(start, ['YYYY-MM-DD', 'DD-MM-YYYY', 'YYYY/MM/DD', 'DD/MM/YYYY']).add(1, 'day').format('YYYY-MM-DD')
    : end;
  return activeRoomBlocks
    .filter(
      (b) =>
        b.start_date < rangeEnd &&
        (b.end_date === null || b.end_date >= start)
    )
    .map((b) => b.roomno);
}

export async function findRoom(
  checkin,
  checkout,
  room_type,
  gender,
  excludeRooms = [],
  t = null,
  floorPref = null,
  priorityList = null,
  adminBlockedRooms = null
) {
  const queryCheckout = checkin === checkout
    ? moment(checkin, ['YYYY-MM-DD', 'DD-MM-YYYY', 'YYYY/MM/DD', 'DD/MM/YYYY']).add(1, 'day').format('YYYY-MM-DD')
    : checkout;
  const blocked = adminBlockedRooms ?? (await fetchBlockedRoomnos(checkin, queryCheckout));
  const priority = priorityList || (await getPriorityOrderForMonth(checkin));
  for (const g of gendersToTry(gender)) {
    const room = await findRoomOfGender(
      checkin, checkout, room_type, g, gender, excludeRooms, t, floorPref, priority, blocked
    );
    if (room) return room;
  }
  return null;
}

async function findRoomOfGender(
  checkin,
  checkout,
  room_type,
  roomGender,
  requestedGender,
  excludeRooms,
  t,
  floorPref,
  priorityList,
  adminBlockedRooms
) {
  const isGroundPref = floorPref === 'ground' || floorPref === '1st' || floorPref === true || requestedGender === 'SCM' || requestedGender === 'SCF';
  const normalizedGender = roomGender;

  const queryCheckout = checkin === checkout
    ? moment(checkin, ['YYYY-MM-DD', 'DD-MM-YYYY', 'YYYY/MM/DD', 'DD/MM/YYYY']).add(1, 'day').format('YYYY-MM-DD')
    : checkout;

  const blockedRooms = Array.isArray(adminBlockedRooms) ? adminBlockedRooms : [];
  const allExcluded = [...new Set([...excludeRooms, ...blockedRooms])];

  const orderClause = buildPriorityOrderClause(priorityList, isGroundPref);

  const whereConditions = {
    roomstatus: STATUS_AVAILABLE,
    roomtype: room_type,
    gender: normalizedGender,
    [Sequelize.Op.and]: [
      { roomno: { [Sequelize.Op.notLike]: 'NA%' } },
      { roomno: { [Sequelize.Op.notLike]: 'WL%' } },
      {
        roomno: {
          [Sequelize.Op.notIn]: Sequelize.literal(
            '(' +
            'SELECT roomno ' +
            'FROM room_booking ' +
            'WHERE (checkout > :reqCheckin AND checkin < :reqCheckout) ' +
            'AND status NOT IN (:excludeStatus1, :excludeStatus2)' +
            ')'
          )
        }
      }
    ]
  };
  if (allExcluded.length > 0) {
    whereConditions[Sequelize.Op.and].push({
      roomno: { [Sequelize.Op.notIn]: allExcluded }
    });
  }

  const queryOptions = {
    where: whereConditions,
    replacements: {
      reqCheckin: checkin,
      reqCheckout: queryCheckout,
      excludeStatus1: STATUS_CANCELLED,
      excludeStatus2: STATUS_ADMIN_CANCELLED
    },
    order: orderClause
  };

  if (t) {
    queryOptions.transaction = t;
    queryOptions.lock = t.LOCK.UPDATE;
  }

  return RoomDb.findOne(queryOptions);
}

export async function findAllRooms(checkin, checkout, room_type, gender, floorPref = null, priorityList = null) {
  const windowCheckout = checkin === checkout
    ? moment(checkin, ['YYYY-MM-DD', 'DD-MM-YYYY', 'YYYY/MM/DD', 'DD/MM/YYYY']).add(1, 'day').format('YYYY-MM-DD')
    : checkout;
  const blockedRooms = await fetchBlockedRoomnos(checkin, windowCheckout);
  const bookings = await RoomBooking.findAll({
    where: {
      [Sequelize.Op.or]: [
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.gte]: checkin } },
            { checkin: { [Sequelize.Op.lt]: windowCheckout } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkout: { [Sequelize.Op.gt]: checkin } },
            { checkout: { [Sequelize.Op.lte]: windowCheckout } }
          ]
        },
        {
          [Sequelize.Op.and]: [
            { checkin: { [Sequelize.Op.lte]: checkin } },
            { checkout: { [Sequelize.Op.gte]: windowCheckout } }
          ]
        }
      ],
      status: {
        [Sequelize.Op.notIn]: [STATUS_CANCELLED, STATUS_ADMIN_CANCELLED]
      }
    }
  });
  const bookedRooms = [...new Set([...bookings.map((x) => x.roomno), ...blockedRooms])];
  const priority = priorityList || (await getPriorityOrderForMonth(checkin));
  const isGroundPref = floorPref === 'ground' || floorPref === '1st' || floorPref === true || gender === 'SCM' || gender === 'SCF';
  const orderClause = buildPriorityOrderClause(priority, isGroundPref);

  return RoomDb.findAll({
    where: {
      roomno: {
        [Sequelize.Op.notLike]: 'NA%',
        [Sequelize.Op.notLike]: 'WL%',
        [Sequelize.Op.notIn]: bookedRooms
      },
      roomstatus: STATUS_AVAILABLE,
      roomtype: room_type,
      ...(gender && { gender })
    },
    order: orderClause
  });
}

export async function bookRoomForMumukshus(
  checkin_date,
  checkout_date,
  mumukshuGroup,
  t,
  user,
  utsav,
  log = logger
) {
  requireMumukshuGroup(mumukshuGroup);
  const mumukshus = mumukshuGroup.flatMap(
    (group) => group.mumukshus || group.guests
  );
  log.info('room_booking_start', {
    checkin: checkin_date,
    checkout: checkout_date,
    mumukshu_count: mumukshus.length,
    bookedBy: user.cardno
  });
  const cardDb = await validateCards(mumukshus);

  // Pass the booking transaction so the rolling-window cap check runs under a
  // card-row lock (race-safe) in a single authoritative pass. roomDetail.status
  // already reflects the cap decision, so the dispatch below just trusts it.
  const roomDetails = await checkRoomAvailabilityForMumukshus(
    checkin_date,
    checkout_date,
    mumukshuGroup,
    user,
    utsav,
    t
  );

  let amount = 0;
  const userBookingIds = {};
  const assignedRooms = [];
  const updatedBy = user.cardno;

  for (const roomDetail of roomDetails) {
    const {
      mumukshu,
      status,
      range,
      nights,
      roomno,
      roomType,
      gender,
      holdReason,
      holdReasonMeta
    } = roomDetail;

    const card = cardDb.filter((item) => item.cardno == mumukshu)[0];
    const bookedBy = card.cardno == user.cardno ? null : user.cardno;

    userBookingIds[card.cardno] = userBookingIds[card.cardno] || [];

    if (status == STATUS_WAITING) {
      const result = await bookWaitingRoom(
        card.cardno,
        range.start,
        range.end,
        nights,
        roomType,
        gender,
        bookedBy,
        updatedBy,
        t,
        holdReason || HOLD_REASON.UNKNOWN,
        holdReasonMeta
      );
      userBookingIds[card.cardno].push(result.bookingId);
    } else if (nights == 0) {
      const result = await bookDayVisit(
        card.cardno,
        range.start,
        range.end,
        bookedBy,
        updatedBy,
        t
      );
      userBookingIds[card.cardno].push(result.bookingid);
    } else if (status == STATUS_AVAILABLE) {
      const result = await bookAvailableRoom(
        card.cardno,
        range.start,
        range.end,
        nights,
        roomno,
        roomType,
        gender,
        bookedBy,
        user,
        false,
        t
      );

      amount += result.discountedAmount;
      userBookingIds[card.cardno].push(result.bookingId);
      assignedRooms.push(result.bookedRoomNo);
    }
  }

  log.info('room_booking_result', {
    amount,
    bookingCount: Object.keys(userBookingIds).length
  });
  return { amount, userBookingIds };
}

export async function createRoomBooking(
  cardno,
  checkin,
  checkout,
  nights,
  roomtype,
  user_gender,
  floor_pref,
  user,
  t,
  cashAllowed = false,
  excludeRooms = [],
  customAmount = null,
  priorityList = null,
  skipCap = false,
  boundaryUtsav = undefined,
  activeRoomBlocks = null
) {
  const gender = floor_pref ? floor_pref + user_gender : user_gender;
  const bookedBy = user.cardno !== cardno ? user.cardno : null;

  // If this is a single-night booking that begins on the Utsav end date
  // OR ends on the Utsav start date,
  // we should mark the booking as WAITING instead of creating a normal booking.
  // This handles the scenario: check-in = utsav.end_date, check-out = utsav.end_date + 1 day.
  const isSingleNight = nights === 1;
  if (isSingleNight) {
    const utsavOnBoundary = await findUtsavOnBoundaryDates(checkin, checkout);
    if (utsavOnBoundary) {
      logger.debug('room_booking_utsav_boundary_waiting', {
        cardno,
        checkin,
        checkout
      });
      const result = await bookWaitingRoom(
        cardno,
        checkin,
        checkout,
        nights,
        roomtype,
        gender,
        bookedBy,
        user.cardno,
        t,
        HOLD_REASON.UTSAV_BOUNDARY
      );
      return result;
    }
  }
  const roomno = await findRoom(
    checkin,
    checkout,
    roomtype,
    gender,
    excludeRooms,
    t,
    floor_pref,
    priorityList,
    activeRoomBlocks ? blockedRoomsInRange(activeRoomBlocks, checkin, checkout) : null
  );

  if (!roomno) {
    throw new ApiError(400, ERR_ROOM_NO_BED_AVAILABLE);
  }

  logger.debug('room_assigned', {
    cardno,
    roomno: roomno.roomno,
    roomtype,
    checkin,
    checkout
  });
  const result = await bookAvailableRoom(
    cardno,
    checkin,
    checkout,
    nights,
    roomno.roomno,
    roomtype,
    gender,
    bookedBy,
    user,
    cashAllowed,
    t
  );
  excludeRooms.push(roomno.roomno);

  return result;
}

export function roomCharge(roomtype) {
  return roomtype == 'nac' ? NAC_ROOM_PRICE : AC_ROOM_PRICE;
}

async function getManualRCBlockForFlat(checkin, checkout) {
  // Find active utsavs at RC (widened by 1 day so utsav auto-block checkout is covered)
  const activeUtsavsAtRC = await UtsavDb.findAll({
    where: {
      location: RESEARCH_CENTRE,
      [Sequelize.Op.and]: [
        { start_date: { [Sequelize.Op.lte]: checkout } },
        {
          end_date: {
            [Sequelize.Op.gte]: moment(checkin).subtract(1, 'day').format('YYYY-MM-DD')
          }
        }
      ]
    }
  });

  const blockedDates = await getBlockedDates(checkin, checkout);
  // Exclude utsav blocks — flat owners may stay in their flats during utsavs.
  // Only genuine manual RC blocks trigger waitlisting for flats.
  const manualBlockedDates = blockedDates.filter((b) => !isBlockFromUtsav(b, activeUtsavsAtRC));

  // Overnight stays: edge-touching blocks don't count. Same-day visits use the strict check,
  // matching the room flow, so a visit on the block's first day is still caught.
  const boundaryAllowed = checkin !== checkout;
  const matchingBlocks = manualBlockedDates.filter((b) =>
    isDateBlocked(b, checkin, checkout, boundaryAllowed)
  );

  // If any overlapping block is a hard block, reject immediately with 400
  const hardBlock = matchingBlocks.find((b) => b.allow_waitlist === false);
  if (hardBlock) {
    throw new ApiError(
      400,
      `Dates are blocked during following periods: ${moment(hardBlock.checkin).format(
        'Do MMMM, YYYY'
      )} to ${moment(hardBlock.checkout).format('Do MMMM, YYYY')}`
    );
  }

  return matchingBlocks[0] || null;
}

export async function bookFlatForMumukshus(
  startDay,
  endDay,
  mumukshus,
  user,
  t,
  createOrder = true,
  log = logger
) {
  log.info('flat_booking_start', {
    startDay,
    endDay,
    mumukshu_count: mumukshus.length,
    bookedBy: user.cardno
  });
  const flat = await FlatDb.findOne({
    attributes: ['flatno'],
    where: {
      owner: user.cardno
    }
  });

  if (!flat) {
    throw new ApiError(404, `Flat not found for ${user.cardno}`);
  }

  validateDate(startDay, endDay);
  const flatCardDb = await validateCards(mumukshus);

  if (await checkFlatAlreadyBooked(startDay, endDay, mumukshus)) {
    throw new ApiError(400, ERR_FLAT_ALREADY_BOOKED);
  }

  const nights = await calculateNights(startDay, endDay);
  const manualRCBlock = await getManualRCBlockForFlat(startDay, endDay);

  // Batched rolling-window cap for the whole group (fixed queries + sorted,
  // deadlock-safe per-person locks), instead of a per-occupant check.
  const capByCard = await checkRollingWindowLimitForCards(
    flatCardDb,
    startDay,
    endDay,
    t
  );

  const userBookingIds = {},
    bookingIds = [];
  let amount = 0;
  for (var mumukshu of mumukshus) {
    const booking = await createFlatBooking(
      mumukshu,
      startDay,
      endDay,
      nights,
      flat.flatno,
      user,
      user.cardno,
      t,
      false,
      capByCard.get(mumukshu),
      manualRCBlock
    );
    amount += booking.discountedAmount;
    userBookingIds[mumukshu] = [booking.bookingId];
    bookingIds.push(booking.bookingId);
  }

  var order = null;
  if (createOrder && amount > 0) {
    order = await generateOrderId(amount);
    await updateRazorpayTransactions(bookingIds, [], order.id, t);
  } else {
    order = { amount };
  }

  return {
    userBookingIds,
    order,
    amount
  };
}

export async function createFlatBooking(
  cardno,
  checkin,
  checkout,
  nights,
  flatno,
  bookedBy,
  updatedBy,
  t,
  cashAllowed = false,
  capResult = null,
  manualRCBlock = null
) {
  let bookingId = uuidv4();

  let status = STATUS_PAYMENT_PENDING;

  const mumukshuIsFlatOwner = await isMumukshuFlatOwner(cardno, flatno);
  if (mumukshuIsFlatOwner) {
    status = ROOM_STATUS_PENDING_CHECKIN;
  }

  // If dates fall in manual RC block, force WAITING with no charge.
  // 9-night / 30-day rolling cap → force waiting. `capResult` is precomputed by
  // the caller's batched check (already a no-op for residents); the admin path
  // omits it (it warns via its own gate).
  let holdReason = null;
  let holdReasonMeta = null;
  if (manualRCBlock) {
    status = STATUS_WAITING;
    holdReason = HOLD_REASON.RC_BLOCKED;
    holdReasonMeta = {
      checkin: manualRCBlock.checkin,
      checkout: manualRCBlock.checkout,
      comments: manualRCBlock.comments
    };
  } else if (nights > 0 && capResult && capResult.exceeds) {
    status = STATUS_WAITING;
    holdReason = HOLD_REASON.ROLLING_WINDOW_LIMIT;
    holdReasonMeta = {
      windowNights: capResult.windowNights,
      limit: ROLLING_WINDOW_NIGHT_LIMIT
    };
  }

  const booking = await FlatBooking.create(
    {
      bookingid: bookingId,
      cardno,
      flatno,
      checkin,
      checkout,
      nights,
      updatedBy,
      bookedBy: bookedBy.cardno == cardno ? null : bookedBy.cardno,
      status,
      hold_reason: holdReason,
      hold_reason_meta: holdReasonMeta
    },
    { transaction: t }
  );

  if (!booking) {
    throw new ApiError(400, ERR_FLAT_FAILED_TO_BOOK);
  }

  let discountedAmount = 0;
  if (!mumukshuIsFlatOwner && status !== STATUS_WAITING) {
    // Check if flat is AC or NAC
    let amount = roomCharge('nac') * nights;

    const result = await createPendingTransaction(
      bookedBy,
      booking,
      TYPE_FLAT,
      amount,
      updatedBy,
      t,
      cashAllowed
    );

    discountedAmount = result.discountedAmount;
  }

  return { t, discountedAmount, bookingId };
}

async function isMumukshuFlatOwner(cardno, flatno) {
  const flat = await FlatDb.findOne({
    attributes: ['flatno'],
    where: {
      owner: cardno,
      flatno: flatno
    }
  });

  return flat ? true : false;
}

export async function checkRoomAvailabilityForMumukshus(
  checkin_date,
  checkout_date,
  mumukshuGroup,
  user,
  utsav,
  t = null
) {
  validateDate(checkin_date, checkout_date);
  requireMumukshuGroup(mumukshuGroup);

  const mumukshus = mumukshuGroup.flatMap(
    (group) => group.mumukshus || group.guests
  );
  const cardDb = await validateCards(mumukshus);

  if (await checkRoomAlreadyBooked(checkin_date, checkout_date, ...mumukshus)) {
    throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
  }

  const dateRangesByMumukshu = await getDateRangesDuringUtsav(
    mumukshus,
    checkin_date,
    checkout_date,
    utsav
  );

  // Create a temp user with cloned credits to track usage during this validation loop
  // without mutating the original user object.
  const tempUser = { ...user, credits: { ...user.credits } };

  // Determine occupants over the 9-night / 30-day rolling cap up front, so they
  // are waitlisted WITHOUT reserving a room another occupant could use. One
  // batched call (not per-occupant) keeps this to a fixed few queries for a
  // group. When called within a booking transaction (t set) it also takes the
  // batched card-row lock, making the client's auto-waitlist decision race-safe
  // in one pass. (Admin bookings don't auto-waitlist — they warn via a gate.)
  const rangesByCard = {};
  for (const mum of mumukshus) {
    rangesByCard[mum] = (dateRangesByMumukshu[mum] || []).map((r) => ({
      checkin: r.start,
      checkout: r.end
    }));
  }
  const capByCard = await checkRollingWindowLimitBatch({
    cards: cardDb,
    rangesByCard,
    t
  });
  const overCapUsage = new Map();
  for (const [cno, cap] of capByCard) {
    if (cap.exceeds) overCapUsage.set(cno, cap.windowNights);
  }

  var roomDetails = [];
  const assignedRooms = [];

  for (const group of mumukshuGroup) {
    const { roomType, floorType } = group;
    const mumukshus = group.mumukshus || group.guests;

    for (const mumukshu of mumukshus) {
      const card = cardDb.filter((item) => item.cardno == mumukshu)[0];
      const gender = floorType ? floorType + card.gender : card.gender;

      const dateRanges = dateRangesByMumukshu[mumukshu];
      for (const range of dateRanges) {
        var status = STATUS_WAITING;
        var charge = 0;
        var availableCredits = 0;
        var assignedRoom = null;
        // Why this range would be waitlisted (only used when status stays WAITING).
        var holdReason = null;
        var holdReasonMeta = null;

        const nights = await calculateNights(range.start, range.end);
        const minNights = range.overlappingWithUtsav && nights > 0 ? 1 : 0;

        if (range.manualRCBlocked) {
          status = STATUS_WAITING;
          holdReason = HOLD_REASON.RC_BLOCKED;
          holdReasonMeta = {
            checkin: range.blockedDate?.checkin,
            checkout: range.blockedDate?.checkout,
            comments: range.blockedDate?.comments
          };
        } else if (nights == 0) {
          // 1 day visit
          status = STATUS_AVAILABLE;
        } else if (overCapUsage.has(mumukshu)) {
          // over the rolling cap → stay waitlisted (status already WAITING),
          // do not consume a room
          holdReason = HOLD_REASON.ROLLING_WINDOW_LIMIT;
          holdReasonMeta = {
            windowNights: overCapUsage.get(mumukshu),
            limit: ROLLING_WINDOW_NIGHT_LIMIT
          };
        } else if (nights > minNights) {
          // when booking around utsav, 2 or more nights are confirmed
          // but 1 night is waitlisted.
          const roomno = await findRoom(
            range.start,
            range.end,
            roomType,
            gender,
            assignedRooms
          );
          if (roomno) {
            status = STATUS_AVAILABLE;
            charge = roomCharge(roomType) * nights;
            availableCredits = usableCredits(tempUser, TYPE_ROOM, charge);
            assignedRoom = roomno.roomno;
            assignedRooms.push(roomno.roomno);
          } else {
            // no bed free for these dates → scarcity waitlist
            holdReason = HOLD_REASON.ROOM_UNAVAILABLE;
          }
        } else {
          // single night on an utsav boundary date → waitlisted for review
          holdReason = HOLD_REASON.UTSAV_BOUNDARY;
        }

        roomDetails.push({
          mumukshu,
          status,
          charge,
          availableCredits,
          holdReason,
          holdReasonMeta,
          dates: range.start + ' to ' + range.end,
          range,
          nights,
          roomType,
          gender,
          ...(assignedRoom && { roomno: assignedRoom })
        });
      }
    }
  }

  return roomDetails;
}

export async function checkFlatAvailabilityForMumukshus(
  checkin_date,
  checkout_date,
  mumukshus,
  user
) {
  const flat = await FlatDb.findOne({
    attributes: ['flatno'],
    where: {
      owner: user.cardno
    }
  });

  if (!flat) {
    throw new ApiError(404, 'User does not own a flat');
  }

  validateDate(checkin_date, checkout_date);
  const flatCardDb = await validateCards(mumukshus);

  if (await checkFlatAlreadyBooked(checkin_date, checkout_date, mumukshus)) {
    throw new ApiError(400, ERR_FLAT_ALREADY_BOOKED);
  }

  const nights = await calculateNights(checkin_date, checkout_date);
  const manualRCBlock = await getManualRCBlockForFlat(checkin_date, checkout_date);
  const flatDetails = [];

  const flatOwnerData = await FlatDb.findAll({
    where: {
      owner: mumukshus
    }
  });

  // Preview the 9-night/30-day cap so this matches the actual booking outcome:
  // createFlatBooking forces WAITING with no charge when the cap is exceeded.
  // No transaction (read-only preview → no lock); residents are exempt centrally.
  const capByCard = await checkRollingWindowLimitForCards(
    flatCardDb,
    checkin_date,
    checkout_date
  );

  // Create a temp user with cloned credits to track usage during this validation loop without mutating the original user object.
  const tempUser = { ...user, credits: { ...user.credits } };

  for (const mumukshu of mumukshus) {
    if (manualRCBlock) {
      flatDetails.push({
        mumukshu,
        flatno: flat.flatno,
        nights,
        charge: 0,
        availableCredits: 0,
        status: STATUS_WAITING,
        holdReason: HOLD_REASON.RC_BLOCKED,
        holdReasonMeta: {
          checkin: manualRCBlock.checkin,
          checkout: manualRCBlock.checkout,
          comments: manualRCBlock.comments
        }
      });
      continue;
    }

    const cap = capByCard.get(mumukshu);
    if (cap.exceeds) {
      // Over the cap → waitlisted with no charge, mirroring createFlatBooking.
      flatDetails.push({
        mumukshu: mumukshu,
        flatno: flat.flatno,
        nights: nights,
        availableCredits: 0,
        ...rollingWaitlistFields(cap)
      });
      continue;
    }

    const isFlatOwner = flatOwnerData.some(
      (item) => item.dataValues.owner == mumukshu
    );

    const charge = isFlatOwner ? 0 : roomCharge('nac') * nights;
    const availableCredits =
      charge > 0 ? usableCredits(tempUser, TYPE_FLAT, charge) : 0;

    flatDetails.push({
      mumukshu: mumukshu,
      flatno: flat.flatno,
      nights: nights,
      charge: charge,
      availableCredits: availableCredits,
      status: STATUS_AVAILABLE
    });
  }

  return flatDetails;
}
