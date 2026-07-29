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
  ERR_BLOCKED_DATES
} from '../config/constants.js';
import {
  RoomBooking,
  RoomDb,
  FlatBooking,
  FlatDb,
  CardDb
} from '../models/associations.js';
import RoomBlock from '../models/room_block.model.js';
import RoomBookingExemption from '../models/room_booking_exemption.model.js';
import RoomAllocationPriority from '../models/room_allocation_priority.model.js';
import {
  createPendingTransaction,
  generateOrderId,
  updateRazorpayTransactions,
  usableCredits
} from './transactions.helper.js';
import {
  calculateNights,
  checkFlatAlreadyBooked,
  validateDate,
  getBlockedDates,
  validateBlockedDates
} from '../controllers/helper.js';
import {
  findUtsavOnBoundaryDates,
  getDateRangesDuringUtsav
} from './utsavBooking.helper.js';
import { v4 as uuidv4 } from 'uuid';
import { validateCard, validateCards } from './card.helper.js';
import moment from 'moment';
import {
  checkRollingWindowLimit,
  checkRollingWindowLimitBatch,
  checkRollingWindowLimitForCards,
  rollingWaitlistFields
} from './rollingWindow.helper.js';
import Sequelize from 'sequelize';
import ApiError from '../utils/ApiError.js';
import logger from '../config/logger.js';

export async function checkRoomAlreadyBooked(checkin, checkout, ...cardnos) {
  const queryCheckout = checkin === checkout
    ? moment(checkin).add(1, 'day').format('YYYY-MM-DD')
    : checkout;

  const result = await RoomBooking.findAll({
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
  const effectiveCheckout = checkin === checkout
    ? moment(checkin).add(1, 'day').format('YYYY-MM-DD')
    : checkout;

  const booking = await RoomBooking.create(
    {
      bookingid: uuidv4(),
      cardno,
      checkin,
      checkout: effectiveCheckout,
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
  const effectiveCheckout = checkin === checkout
    ? moment(checkin).add(1, 'day').format('YYYY-MM-DD')
    : checkout;

  await RoomBooking.create(
    {
      bookingid: bookingId,
      roomno: 'NA',
      status: STATUS_WAITING,
      cardno,
      bookedBy,
      checkin,
      checkout: effectiveCheckout,
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
  const effectiveCheckout = checkin === checkout
    ? moment(checkin).add(1, 'day').format('YYYY-MM-DD')
    : checkout;

  const booking = await RoomBooking.create(
    {
      bookingid: bookingId,
      roomno,
      status: STATUS_PAYMENT_PENDING,
      cardno,
      bookedBy,
      checkin,
      checkout: effectiveCheckout,
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

  const amount = nights === 0 ? (roomCharge(roomtype) / 2) : (roomCharge(roomtype) * nights);

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
  // Fail safe: any parse/query problem falls back to the default ordering rather
  // than throwing and breaking room allocation.
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

  // Guard the hardcoded room-number bands (1-18/19-36/37-48/49-60) against
  // roomnos that don't match the expected `<digits><letter>` shape (e.g. 'NA',
  // 'WL', or any malformed value). Such rooms are pushed to the end (band 99 /
  // large numeric key) so a bad roomno falls back to default ordering instead
  // of mis-sorting — CAST of a non-numeric prefix would otherwise coerce to 0
  // and float unparseable rooms to the top.
  const ROOMNO_SHAPE = `roomno REGEXP '^[0-9]+[A-Za-z]$'`;
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
    Sequelize.literal(`SUBSTRING(roomno, LENGTH(roomno)) ASC`)
  ];
}

export async function findRoom(
  checkin,
  checkout,
  room_type,
  gender,
  excludeRooms = [],
  t = null,
  floorPref = null,
  // Optional: pass a pre-fetched allocation priority list to avoid re-querying
  // getPriorityOrderForMonth on every call (N+1 in per-guest loops). When null
  // we fetch it here for backward compatibility.
  priorityList = null
) {
  const isGroundPref = floorPref === 'ground' || floorPref === '1st' || floorPref === true || gender === 'SCM' || gender === 'SCF';
  const normalizedGender = (gender === 'SCM' ? 'M' : (gender === 'SCF' ? 'F' : gender));

  const queryCheckout = checkin === checkout
    ? moment(checkin, ['YYYY-MM-DD', 'DD-MM-YYYY', 'YYYY/MM/DD', 'DD/MM/YYYY']).add(1, 'day').format('YYYY-MM-DD')
    : checkout;

  // Get admin-blocked rooms overlapping [checkin, queryCheckout)
  const blocks = await RoomBlock.findAll({
    attributes: ['roomno'],
    where: {
      status: 'active',
      start_date: { [Sequelize.Op.lt]: queryCheckout },
      [Sequelize.Op.or]: [
        { end_date: null },
        { end_date: { [Sequelize.Op.gt]: checkin } }
      ]
    }
  });
  const blockedRooms = blocks.map((b) => b.roomno);
  const allExcluded = [...new Set([...excludeRooms, ...blockedRooms])];

  const whereConditions = {
    roomtype: room_type,
    gender: normalizedGender,
    [Sequelize.Op.and]: [
      { roomno: { [Sequelize.Op.notLike]: 'NA%' } },
      { roomno: { [Sequelize.Op.notLike]: 'WL%' } },
      {
        roomno: {
          [Sequelize.Op.notIn]: Sequelize.literal(`(
            SELECT roomno 
            FROM room_booking 
            WHERE (checkout > :reqCheckin AND checkin < :reqCheckout)
          AND status NOT IN (:excludeStatus1, :excludeStatus2)
          )`)
        }
      }
    ]
  };

  if (allExcluded.length > 0) {
    whereConditions[Sequelize.Op.and].push({
      roomno: { [Sequelize.Op.notIn]: allExcluded }
    });
  }

  const effectivePriorityList =
    priorityList || (await getPriorityOrderForMonth(checkin));
  const orderClause = buildPriorityOrderClause(effectivePriorityList, isGroundPref);

  return RoomDb.findOne({
    attributes: ['roomno'],
    where: whereConditions,
    order: orderClause,
    replacements: {
      reqCheckin: checkin,
      reqCheckout: queryCheckout,
      excludeStatus1: 'cancelled',
      excludeStatus2: 'admin cancelled'
    },
    transaction: t,
    lock: t ? t.LOCK.UPDATE : undefined,
    limit: 1
  });
}

export async function findAllRooms(checkin, checkout, room_type, gender, floorPref = null) {
  const isGroundPref = floorPref === 'ground' || floorPref === '1st' || floorPref === true || gender === 'SCM' || gender === 'SCF';
  const normalizedGender = (gender === 'SCM' ? 'M' : (gender === 'SCF' ? 'F' : gender));

  const queryCheckout = checkin === checkout
    ? moment(checkin).add(1, 'day').format('YYYY-MM-DD')
    : checkout;

  // Get admin-blocked rooms overlapping [checkin, queryCheckout)
  const blocks = await RoomBlock.findAll({
    attributes: ['roomno'],
    where: {
      status: 'active',
      start_date: { [Sequelize.Op.lt]: queryCheckout },
      [Sequelize.Op.or]: [
        { end_date: null },
        { end_date: { [Sequelize.Op.gt]: checkin } }
      ]
    }
  });
  const adminBlockedRooms = blocks.map((b) => b.roomno);

  const bookings = await RoomBooking.findAll({
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
      status: {
        [Sequelize.Op.notIn]: [STATUS_CANCELLED, STATUS_ADMIN_CANCELLED]
      }
    }
  });
  const bookedRooms = bookings.map((x) => x.roomno);
  const allExcluded = [...new Set([...bookedRooms, ...adminBlockedRooms])];

  const priorityList = await getPriorityOrderForMonth(checkin);
  const orderClause = buildPriorityOrderClause(priorityList, isGroundPref);

  return RoomDb.findAll({
    where: {
      roomno: {
        [Sequelize.Op.notLike]: 'NA%',
        [Sequelize.Op.notLike]: 'WL%',
        [Sequelize.Op.notIn]: allExcluded.length > 0 ? allExcluded : ['']
      },
      roomtype: room_type,
      ...(normalizedGender && { gender: normalizedGender })
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
  log = logger,
  extra_stay_reason = null
) {
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

  // "Blocked = unavailable" (centre block, or a non-attended overlapping utsav)
  // is rejected inside checkRoomAvailabilityForMumukshus above — with the booking
  // transaction's cap lock held — so a blocked stay throws before any room is
  // written. No separate guard is needed here.

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

    if (nights == 0) {
      if (roomType === 'NA') {
        const result = await bookDayVisit(
          card.cardno,
          range.start,
          range.end,
          bookedBy,
          updatedBy,
          t
        );
        userBookingIds[card.cardno].push(result.bookingid);
      } else if (status == STATUS_WAITING) {
        const result = await bookWaitingRoom(
          card.cardno,
          range.start,
          range.end,
          nights,
          roomType,
          gender,
          bookedBy,
          updatedBy,
          t
        );
        userBookingIds[card.cardno].push(result.bookingId);
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
    } else if (status == STATUS_WAITING) {
      // For an over-cap hold, fold the user's extra-stay reason into the meta so
      // it persists as `hold_reason_meta.userReason`. Room-full / utsav-boundary
      // holds keep their own reason and meta untouched. Reason stays optional.
      const effectiveMeta =
        holdReason === HOLD_REASON.ROLLING_WINDOW_LIMIT && extra_stay_reason
          ? { ...(holdReasonMeta || {}), userReason: extra_stay_reason }
          : holdReasonMeta;
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
        effectiveMeta
      );
      userBookingIds[card.cardno].push(result.bookingId);
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
  extra_stay_reason = null,
  // Optional pre-fetched allocation priority list, threaded through to findRoom
  // so bulk/loop callers fetch it once instead of per booking (N+1 fix).
  priorityList = null
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

  // 9-night / 30-day rolling cap (admin + bulk write path). The admin path is
  // NON-BLOCKING by design — the controller attaches a getRollingWindowWarning to
  // the success response — so we do NOT throw here; we simply route an over-cap
  // stay to waiting instead of assigning a room, mirroring the client funnel.
  // The cap applies to the OCCUPANT (`cardno`), so fetch that card (guarantees
  // res_status for the residency/exemption fold); residents/exempt come back as
  // exceeds:false. A supplied extra_stay_reason is persisted as
  // hold_reason_meta.userReason (omitted when none).
  if (nights > 0) {
    const occupantCard = await validateCard(cardno);
    const cap = await checkRollingWindowLimit({
      card: occupantCard,
      ranges: [{ checkin, checkout }],
      t
    });
    if (cap.exceeds) {
      logger.debug('room_booking_rolling_cap_waiting', {
        cardno,
        checkin,
        checkout,
        windowNights: cap.windowNights
      });
      const holdReasonMeta = {
        windowNights: cap.windowNights,
        limit: ROLLING_WINDOW_NIGHT_LIMIT,
        ...(extra_stay_reason ? { userReason: extra_stay_reason } : {})
      };
      return await bookWaitingRoom(
        cardno,
        checkin,
        checkout,
        nights,
        roomtype,
        gender,
        bookedBy,
        user.cardno,
        t,
        HOLD_REASON.ROLLING_WINDOW_LIMIT,
        holdReasonMeta
      );
    }
  }

  const roomno = await findRoom(
    checkin,
    checkout,
    roomtype,
    gender,
    excludeRooms,
    t,
    null,
    priorityList
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

export async function bookFlatForMumukshus(
  startDay,
  endDay,
  mumukshus,
  user,
  t,
  createOrder = true,
  log = logger,
  extra_stay_reason = null
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

  // Flats bypass the Research Centre block: a flat owner may book their flat for
  // people even when RC is blocked. The 9-night/30-day cap below still applies.

  if (await checkFlatAlreadyBooked(startDay, endDay, mumukshus)) {
    throw new ApiError(400, ERR_FLAT_ALREADY_BOOKED);
  }

  const nights = await calculateNights(startDay, endDay);

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
      extra_stay_reason
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
  userReason = null
) {
  let bookingId = uuidv4();

  let status = STATUS_PAYMENT_PENDING;

  const mumukshuIsFlatOwner = await isMumukshuFlatOwner(cardno, flatno);
  if (mumukshuIsFlatOwner) {
    status = ROOM_STATUS_PENDING_CHECKIN;
  }

  // 9-night / 30-day rolling cap → force waiting (SOFT, never a hard-fail — flats
  // behave exactly like rooms now). `capResult` is precomputed by the caller's
  // batched check (already a no-op for residents); the admin path omits it (it
  // warns via its own gate). A supplied userReason persists as
  // hold_reason_meta.userReason (omitted when none — the reason is optional).
  let holdReason = null;
  let holdReasonMeta = null;
  if (nights > 0 && capResult && capResult.exceeds) {
    status = STATUS_WAITING;
    holdReason = HOLD_REASON.ROLLING_WINDOW_LIMIT;
    holdReasonMeta = {
      windowNights: capResult.windowNights,
      limit: ROLLING_WINDOW_NIGHT_LIMIT,
      ...(userReason ? { userReason } : {})
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

  // "Blocked = unavailable": if any occupant's range hit a centre block (or a
  // non-attended overlapping utsav), REJECT here — before the cap lock — so the
  // shared availability path throws. This is what makes /validate reject blocked
  // dates on the add-on screen AND before checkout (and restores the pre-refactor
  // behavior where getDateRangesDuringUtsav threw inline). getDateRangesDuringUtsav
  // now only FLAGS isBlocked because the /stay/blocked-dates endpoint needs the
  // flag WITHOUT throwing, so the hard-reject lives here. Attended-utsav pre/post
  // split segments are never isBlocked, so a legit split still books.
  const blockedRanges = [];
  for (const mum of mumukshus) {
    for (const r of dateRangesByMumukshu[mum] || []) {
      if (r.isBlocked) {
        blockedRanges.push({
          start: r.start,
          end: r.end,
          overlappingWithUtsav: r.overlappingWithUtsav
        });
      }
    }
  }
  if (blockedRanges.length > 0) {
    const blockedDates = await getBlockedDates(checkin_date, checkout_date);
    // Reuse validateBlockedDates so the message names the exact blocked period(s).
    validateBlockedDates(blockedDates, blockedRanges);
    // Safety net if the block rows changed mid-request.
    throw new ApiError(400, ERR_BLOCKED_DATES);
  }

  // Create a temp user with cloned credits to track usage during this validation loop
  // without mutating the original user object.
  const tempUser = { ...user, credits: { ...user.credits } };

  // Determine occupants over the 9-night / 30-day rolling cap up front, so they
  // are waitlisted WITHOUT reserving a room another occupant could use. One
  // batched call (not per-occupant) keeps this to a fixed few queries for a
  // group. When called within a booking transaction (t set) it also takes the
  // batched card-row lock, making the client's auto-waitlist decision race-safe
  // in one pass. (Admin bookings don't auto-waitlist — they warn via a gate.)
  // Cap counts only EFFECTIVE bookable nights: nights the occupant will actually
  // stay in a committed room. Blocked ranges (isBlocked === true) are never
  // bookable ("blocked = unavailable" → rejected on the write path), so they must
  // NOT inflate the rolling-window usage. Excluding them here also means a stay
  // that is entirely inside a block yields no effective ranges → not over-cap →
  // the cap never fires before the write path rejects it for the block.
  const rangesByCard = {};
  for (const mum of mumukshus) {
    rangesByCard[mum] = (dateRangesByMumukshu[mum] || [])
      .filter((r) => !r.isBlocked)
      .map((r) => ({
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
      const gender = floorType === 'SC' ? 'SC' + card.gender : card.gender;

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

        if (range.isBlocked) {
          // Blocked (centre block, or an overlapping utsav the member is NOT
          // attending): NOT bookable and NOT waitlisted. A block waitlist is a
          // dead-end — no room cron promotes it — so "blocked = unavailable".
          // The write path (bookRoomForMumukshus) throws BEFORE any booking is
          // created when it sees an isBlocked range; here in the shared preview
          // we only surface the flag (roomDetails.isBlocked below) so the client
          // can render the reject. No room is assigned, nothing is charged, and
          // no hold reason is invented (a blocked range never becomes a hold).
        } else if (nights == 0) {
          // 1 day visit
          if (roomType === 'NA') {
            status = STATUS_AVAILABLE;
            charge = 0;
          } else {
            const roomno = await findRoom(
              range.start,
              range.end,
              roomType,
              gender,
              assignedRooms
            );
            if (roomno) {
              status = STATUS_AVAILABLE;
              charge = roomCharge(roomType) / 2;
              availableCredits = usableCredits(tempUser, TYPE_ROOM, charge);
              assignedRoom = roomno.roomno;
              assignedRooms.push(roomno.roomno);
            } else {
              status = STATUS_WAITING;
            }
          }
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
          isBlocked: range.isBlocked || false,
          requiresExtraStayReason: overCapUsage.has(mumukshu),
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

  // Flats bypass the Research Centre block: a flat owner may book their flat for
  // people even when RC is blocked. The 9-night/30-day cap below still applies.

  if (await checkFlatAlreadyBooked(checkin_date, checkout_date, mumukshus)) {
    throw new ApiError(400, ERR_FLAT_ALREADY_BOOKED);
  }

  // NOTE: no hard-fail on long stays. Over-cap flats go SOFT (waiting) through the
  // rolling-window engine below, exactly like rooms — the previous
  // `nights > 9 → ERR_ROOM_INVALID_DURATION` throw has been removed.
  const nights = await calculateNights(checkin_date, checkout_date);
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
    const cap = capByCard.get(mumukshu);
    if (cap.exceeds) {
      // Over the cap → waitlisted with no charge, mirroring createFlatBooking.
      flatDetails.push({
        mumukshu: mumukshu,
        flatno: flat.flatno,
        nights: nights,
        availableCredits: 0,
        requiresExtraStayReason: true,
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
