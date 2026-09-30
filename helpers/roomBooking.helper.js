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
  ERR_BLOCKED_DATES,
  HOLD_REASON_COPY
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
  getOverlappingFlatBookings,
  validateDate,
  getBlockedDates,
  validateBlockedDates,
  formatBlockedPeriod,
  isDateBlocked,
  blockNightBounds
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
  const byCard = await getOverlappingRoomBookings(checkin, checkout, cardnos);
  return Object.keys(byCard).length > 0;
}

export async function checkRoomAlreadyBookedInTransaction(checkin, checkout, cardnos, transaction) {
  const byCard = await getOverlappingRoomBookings(checkin, checkout, cardnos, transaction);
  return Object.keys(byCard).length > 0;
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

// Senior-citizen guests (SCM/SCF) get senior-citizen rooms first; when none is
// free they fall back to the ordinary room of the same sex (M/F).
const gendersToTry = (gender) =>
  gender === 'SCM' ? ['SCM', 'M'] : gender === 'SCF' ? ['SCF', 'F'] : [gender];

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
  priorityList = null,
  // Optional: pass pre-fetched admin-blocked roomnos for this exact range to
  // skip the per-call RoomBlock query (same N+1 concern as priorityList).
  adminBlockedRooms = null
) {
  // Read the blocks and the month's priority once, not once per gender tried.
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

// Rooms with an active block on any night of [checkin, queryCheckout). A block's
// end_date is its LAST blocked day (inclusive); NULL = permanent.
async function fetchBlockedRoomnos(checkin, queryCheckout) {
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
}

// All active blocks that touch [checkin, windowCheckout), with their dates, so a
// caller with several stays (or several guests) in the same window reads the
// blocks once and filters per range in memory with blockedRoomsInRange.
export async function fetchActiveRoomBlocks(checkin, checkout) {
  const windowCheckout = checkin === checkout
    ? moment(checkin, ['YYYY-MM-DD', 'DD-MM-YYYY', 'YYYY/MM/DD', 'DD/MM/YYYY']).add(1, 'day').format('YYYY-MM-DD')
    : checkout;
  return RoomBlock.findAll({
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
}

// Rooms blocked on any night of [start, end) out of a fetchActiveRoomBlocks() list.
// end_date is the LAST blocked day (inclusive); NULL = permanent.
export function blockedRoomsInRange(activeRoomBlocks, start, end) {
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

// Locking path of the finder for ONE known room: lock the roomdb row, then
// re-read its overlapping bookings with a LOCKING read (sees the latest
// committed data, unlike the transaction's snapshot). Returns the locked room
// row, or null when the room is not bookable for these dates any more.
export async function lockRoomIfFree(roomno, checkin, checkout, t) {
  const queryCheckout = checkin === checkout
    ? moment(checkin, ['YYYY-MM-DD', 'DD-MM-YYYY', 'YYYY/MM/DD', 'DD/MM/YYYY']).add(1, 'day').format('YYYY-MM-DD')
    : checkout;
  const locked = await RoomDb.findOne({
    attributes: ['roomno'],
    where: { roomno, roomstatus: STATUS_AVAILABLE },
    transaction: t,
    lock: t.LOCK.UPDATE
  });
  if (!locked) return null;
  const clash = await RoomBooking.findOne({
    attributes: ['bookingid'],
    where: {
      roomno,
      checkout: { [Sequelize.Op.gt]: checkin },
      checkin: { [Sequelize.Op.lt]: queryCheckout },
      status: { [Sequelize.Op.notIn]: ['cancelled', 'admin cancelled'] }
    },
    transaction: t,
    lock: t.LOCK.UPDATE
  });
  return clash ? null : locked;
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

  const blockedRooms = adminBlockedRooms;
  const allExcluded = [...new Set([...excludeRooms, ...blockedRooms])];

  const orderClause = buildPriorityOrderClause(priorityList, isGroundPref);

  const buildWhere = (excluded) => {
    const whereConditions = {
      // Belt-and-braces alongside the room_block rows: a room whose legacy
      // roomstatus is 'blocked' must never be assignable, even if its room_block
      // sync row is missing (e.g. an environment that booted via sequelize.sync()
      // before the backfill migration ran, or a direct roomstatus edit).
      roomstatus: STATUS_AVAILABLE,
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
    if (excluded.length > 0) {
      whereConditions[Sequelize.Op.and].push({
        roomno: { [Sequelize.Op.notIn]: excluded }
      });
    }
    return whereConditions;
  };

  const replacements = {
    reqCheckin: checkin,
    reqCheckout: queryCheckout,
    excludeStatus1: 'cancelled',
    excludeStatus2: 'admin cancelled'
  };

  // Read-only path (preview / validate): no locks, plain first match.
  if (!t) {
    return RoomDb.findOne({
      attributes: ['roomno'],
      where: buildWhere(allExcluded),
      order: orderClause,
      replacements,
      limit: 1
    });
  }

  // Locking path. The candidate scan above runs against this transaction's
  // REPEATABLE-READ snapshot, so its "already booked" subquery can be stale: a
  // concurrent transaction may have booked (and committed) the same room after
  // the snapshot was taken. Lock only the candidate room's row (this
  // serialises concurrent bookers of that room), then re-read its overlapping
  // bookings with a LOCKING read, which sees the latest committed data. If the
  // room turned out to be taken, skip it and try the next candidate.
  const tried = [];
  const BATCH = 10;
  const MAX_ATTEMPTS = 200;
  while (tried.length < MAX_ATTEMPTS) {
    const candidates = await RoomDb.findAll({
      attributes: ['roomno'],
      where: buildWhere([...allExcluded, ...tried]),
      order: orderClause,
      replacements,
      transaction: t,
      limit: BATCH
    });
    if (candidates.length === 0) return null;

    for (const candidate of candidates) {
      const locked = await lockRoomIfFree(candidate.roomno, checkin, checkout, t);
      if (locked) return locked;
      tried.push(candidate.roomno);
    }
  }
  return null;
}

export async function findAllRooms(checkin, checkout, room_type, gender, floorPref = null) {
  const isGroundPref = floorPref === 'ground' || floorPref === '1st' || floorPref === true || gender === 'SCM' || gender === 'SCF';
  // SC guests: SC rooms first, then the ordinary rooms of the same sex.
  const genders = gendersToTry(gender);

  const queryCheckout = checkin === checkout
    ? moment(checkin).add(1, 'day').format('YYYY-MM-DD')
    : checkout;

  const adminBlockedRooms = await fetchBlockedRoomnos(checkin, queryCheckout);

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

  const rooms = await RoomDb.findAll({
    where: {
      // Op.and array, NOT repeated computed keys: `[Op.notLike]` twice in one
      // object literal is the same Symbol key, so the second silently replaced
      // the first and the 'NA%' filter was dropped.
      [Sequelize.Op.and]: [
        { roomno: { [Sequelize.Op.notLike]: 'NA%' } },
        { roomno: { [Sequelize.Op.notLike]: 'WL%' } },
        { roomno: { [Sequelize.Op.notIn]: allExcluded.length > 0 ? allExcluded : [''] } }
      ],
      // Belt-and-braces alongside the room_block rows (see findRoom).
      roomstatus: STATUS_AVAILABLE,
      roomtype: room_type,
      ...(gender && { gender: { [Sequelize.Op.in]: genders } })
    },
    order: orderClause
  });
  // Keep SC rooms ahead of the ordinary fallback rooms (stable sort).
  return genders.length > 1
    ? [...genders.flatMap((g) => rooms.filter((r) => r.gender === g))]
    : rooms;
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

  // Read once for the whole request and shared with the availability pass and
  // the locked room pick below (each used to re-read them).
  const priorityList = await getPriorityOrderForMonth(checkin_date);
  const activeRoomBlocks = await fetchActiveRoomBlocks(checkin_date, checkout_date);

  // Pass the booking transaction so the rolling-window cap check runs under a
  // card-row lock (race-safe) in a single authoritative pass. roomDetail.status
  // already reflects the cap decision, so the dispatch below just trusts it.
  const roomDetails = await checkRoomAvailabilityForMumukshus(
    checkin_date,
    checkout_date,
    mumukshuGroup,
    user,
    utsav,
    t,
    false,
    { cardDb, priorityList, activeRoomBlocks }
  );

  // "Blocked = unavailable" (centre block, or a non-attended overlapping utsav)
  // is rejected inside checkRoomAvailabilityForMumukshus above — with the booking
  // transaction's cap lock held — so a blocked stay throws before any room is
  // written. No separate guard is needed here.

  let amount = 0;
  const userBookingIds = {};
  const assignedRooms = [];
  const updatedBy = user.cardno;

  // The preview above picked each roomno WITHOUT a row lock (it also serves the
  // read-only /validate path), so a concurrent request may have taken the same
  // bed in the meantime. Re-select under the booking transaction with the same
  // findRoom(..., t) SELECT ... FOR UPDATE the admin/bulk path
  // (createRoomBooking) relies on, so two concurrent bookings cannot be handed
  // the same bed. If every matching bed is gone (raced away since the preview),
  // fall back to the scarcity waitlist — the same answer the preview itself
  // gives when no bed is free — instead of failing the whole group booking.
  const bookAvailableRoomLocked = async (occupantCardno, bookedBy, roomDetail) => {
    const { range, nights, roomType, gender } = roomDetail;
    // The availability pass already picked a bed for this stay (roomDetail.roomno,
    // best free bed, distinct from the other guests'). Try that one first: lock
    // it and re-read its bookings. Only if it was taken meanwhile, run the full
    // finder again (with the blocks already in hand).
    let lockedRoom = null;
    if (roomDetail.roomno && !assignedRooms.includes(roomDetail.roomno)) {
      lockedRoom = await lockRoomIfFree(roomDetail.roomno, range.start, range.end, t);
    }
    if (!lockedRoom) {
      lockedRoom = await findRoom(
        range.start,
        range.end,
        roomType,
        gender,
        assignedRooms,
        t,
        null,
        priorityList,
        blockedRoomsInRange(activeRoomBlocks, range.start, range.end)
      );
    }
    if (!lockedRoom) {
      log.warn('room_booking_bed_raced_away', {
        cardno: occupantCardno,
        checkin: range.start,
        checkout: range.end,
        roomType
      });
      return bookWaitingRoom(
        occupantCardno,
        range.start,
        range.end,
        nights,
        roomType,
        gender,
        bookedBy,
        updatedBy,
        t,
        HOLD_REASON.ROOM_UNAVAILABLE
      );
    }
    const result = await bookAvailableRoom(
      occupantCardno,
      range.start,
      range.end,
      nights,
      lockedRoom.roomno,
      roomType,
      gender,
      bookedBy,
      user,
      false,
      t
    );
    assignedRooms.push(result.bookedRoomNo);
    return result;
  };

  // Lock order. Each guest's room row is locked as it is booked, so two group
  // bookings that list the same guests in opposite order (A=[M,F], B=[F,M])
  // used to lock the M and F rooms in opposite order and deadlock (MySQL 1213
  // -> HTTP 500). Book in one fixed order everywhere: room type, then the
  // gender pool (SCM rooms/M rooms, then SCF rooms/F rooms). A stable sort, so a
  // guest's own split ranges keep their date order.
  // A stay that already has a chosen bed (roomDetail.roomno) locks that bed, so
  // the beds themselves are locked in one global order (room type, then room
  // number) no matter which guest holds them or which pool (SCM/M/SCF/F) they
  // came from: two groups contesting the same beds then always lock them in the
  // same order. Stays without a bed (waitlist, or a bed to be found again) come
  // after, in the pool order used before.
  const roomKey = (no) => {
    const m = /^(\d+)([A-Za-z]*)$/.exec(String(no));
    return m ? `${m[1].padStart(6, '0')}${m[2]}` : `~${no}`;
  };
  const lockRank = (d) =>
    d.roomno
      ? `0|${d.roomType || ''}|${roomKey(d.roomno)}`
      : `1|${d.roomType || ''}|${{ SCM: 0, M: 1, SCF: 2, F: 3 }[d.gender] ?? 4}`;
  const lockOrdered = [...roomDetails].sort((x, y) => {
    const a = lockRank(x), b = lockRank(y);
    return a < b ? -1 : a > b ? 1 : 0;
  });

  for (const roomDetail of lockOrdered) {
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
          t,
          holdReason || HOLD_REASON.UNKNOWN,
          holdReasonMeta
        );
        userBookingIds[card.cardno].push(result.bookingId);
      } else if (status == STATUS_AVAILABLE) {
        const result = await bookAvailableRoomLocked(
          card.cardno,
          bookedBy,
          roomDetail
        );
        amount += result.discountedAmount;
        userBookingIds[card.cardno].push(result.bookingId);
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
      const result = await bookAvailableRoomLocked(
        card.cardno,
        bookedBy,
        roomDetail
      );

      amount += result.discountedAmount;
      userBookingIds[card.cardno].push(result.bookingId);
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
  priorityList = null,
  // Admin and overstay bookings are never held back by the 9-night rolling cap:
  // the stay is confirmed and billed, and the admin caller reports a warning.
  // Only member-facing paths leave this false.
  skipCap = false,
  // Optional pre-fetched utsav on the stay's boundary dates (null = none).
  // undefined means "look it up". Bulk callers share one lookup across rows.
  boundaryUtsav = undefined,
  // Optional pre-fetched active room blocks (fetchActiveRoomBlocks) for the
  // whole stay window, so a loop of guests reads the blocks once. null = the
  // finder reads them itself.
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
    const utsavOnBoundary =
      boundaryUtsav !== undefined
        ? boundaryUtsav
        : await findUtsavOnBoundaryDates(checkin, checkout);
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

  // 9-night / 30-day rolling cap. Skipped (skipCap) for admin, bulk and overstay
  // bookings: those are confirmed and billed, and the calling controller attaches
  // a rolling-window warning for staff. When not skipped, an over-cap stay goes
  // to waiting instead of getting a room.
  // The cap applies to the OCCUPANT (`cardno`), so fetch that card (guarantees
  // res_status for the residency/exemption fold); residents/exempt come back as
  // exceeds:false. A supplied extra_stay_reason is persisted as
  // hold_reason_meta.userReason (omitted when none).
  if (nights > 0 && !skipCap) {
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

/**
 * Prices and resolves a stay request without writing anything.
 *
 * `preview` changes only WHO reports a hard no, never what counts as one.
 *  - preview === false (default, the booking write path): a blocked range or an
 *    overlapping booking THROWS, so no booking row can ever be created for
 *    dates the member may not have.
 *  - preview === true (the /validate path): the same two cases come back as
 *    rows flagged `isBlocked` / `isAlreadyBooked` with a member-facing
 *    `unavailableReason`. The client then renders all three answers — cannot
 *    book, waitlisted, confirmed — in one place, per person and per segment,
 *    instead of showing a raw error string in a modal.
 *
 * Every waitlisted row also carries `holdReasonMessage`, the backend-owned
 * sentence from HOLD_REASON_COPY. Clients display it directly, so adding a
 * fifth hold reason needs no client release.
 */
export async function checkRoomAvailabilityForMumukshus(
  checkin_date,
  checkout_date,
  mumukshuGroup,
  user,
  utsav,
  t = null,
  preview = false,
  // Optional reads the caller already made for this same request (the booking
  // path reads them once and passes them on): { cardDb, priorityList,
  // activeRoomBlocks }. Anything missing is read here.
  shared = {}
) {
  validateDate(checkin_date, checkout_date);
  requireMumukshuGroup(mumukshuGroup);

  const mumukshus = mumukshuGroup.flatMap(
    (group) => group.mumukshus || group.guests
  );
  const cardDb = shared.cardDb || (await validateCards(mumukshus));

  const overlappingByCard = await getOverlappingRoomBookings(
    checkin_date,
    checkout_date,
    mumukshus
  );
  if (Object.keys(overlappingByCard).length > 0 && !preview) {
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
  // shared availability path throws. getDateRangesDuringUtsav only FLAGS
  // isBlocked because the /stay/blocked-dates endpoint needs the flag WITHOUT
  // throwing, so the hard-reject lives here. Attended-utsav pre/post split
  // segments are never isBlocked, so a legit split still books.
  const blockedRanges = [];
  for (const mum of mumukshus) {
    for (const r of dateRangesByMumukshu[mum] || []) {
      if (r.isBlocked) {
        blockedRanges.push({
          start: r.start,
          end: r.end,
          overlappingWithUtsav: r.overlappingWithUtsav,
          // Set only for a stay that lies wholly inside an utsav this member
          // attends — those nights are the festival's, not a centre closure.
          blockedReason: r.blockedReason || null
        });
      }
    }
  }
  // The preview keeps going and reports the block per range. Only the write path
  // throws, which is what makes a blocked booking impossible to create.
  let blockedReason = null;
  if (blockedRanges.length > 0) {
    // getBlockedDates(checkin_date, checkout_date) returns every block_dates
    // row overlapping the WHOLE requested window — including an attended
    // utsav's own auto-block, which exists regardless of who is attending.
    // blockedRanges already excludes the attended-utsav split (that member's
    // stay never carries an isBlocked range there), so naming every raw row
    // here named the utsav's own dates as "closed" even though this member's
    // stay legitimately splits around them. Keep only the rows that actually
    // overlap one of the ranges genuinely blocked for this member.
    const blockedDates = (await getBlockedDates(checkin_date, checkout_date)).filter((block) => {
      const effectiveCheckout = blockNightBounds(block.checkin, block.checkout)
        .effectiveCheckout.format('YYYY-MM-DD');
      const normalizedBlock = {
        checkin: block.checkin,
        checkout: effectiveCheckout
      };
      return blockedRanges.some((range) =>
        isDateBlocked(normalizedBlock, range.start, range.end, range.overlappingWithUtsav)
      );
    });
    if (!preview) {
      // A stay wholly inside an attended utsav explains itself; quoting the
      // festival's own auto-block as a centre closure would contradict the
      // blocked-dates calendar, which tells this same member those nights are
      // part of the utsav they are attending.
      const ownUtsavRange = blockedRanges.find((r) => r.blockedReason);
      if (ownUtsavRange) {
        throw new ApiError(400, ownUtsavRange.blockedReason);
      }
      // Reuse validateBlockedDates so the message names the exact blocked period(s).
      validateBlockedDates(blockedDates, blockedRanges);
      // Safety net if the block rows changed mid-request.
      throw new ApiError(400, ERR_BLOCKED_DATES);
    }
    const periods = blockedDates.map((b) => formatBlockedPeriod(b)).join(', ');
    blockedReason = periods
      ? `The centre is closed on these dates (${periods}), so this stay cannot be booked.`
      : 'The centre is closed on these dates, so this stay cannot be booked.';
  }

  // Write path only (a booking transaction was supplied): lock every occupant's
  // card row in sorted order — the same global ordering rule as
  // checkRollingWindowLimitBatch and bulkRoomBooking, so the paths cannot
  // deadlock each other — then re-check overlapping bookings INSIDE the
  // transaction. The unlocked check above fast-fails the common case; this one
  // closes the race where two concurrent requests for the same card both pass
  // it and double-book.
  if (t && !preview) {
    for (const cno of [...new Set(mumukshus.map(String))].sort()) {
      await CardDb.findOne({
        where: { cardno: cno },
        attributes: ['cardno'],
        transaction: t,
        lock: t.LOCK.UPDATE
      });
    }
    if (
      await checkRoomAlreadyBookedInTransaction(
        checkin_date,
        checkout_date,
        mumukshus,
        t
      )
    ) {
      throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
    }
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
    t,
    // The write path locked every occupant's card row above, in sorted order.
    cardsLocked: !!(t && !preview)
  });
  const overCapUsage = new Map();
  for (const [cno, cap] of capByCard) {
    if (cap.exceeds) overCapUsage.set(cno, cap.windowNights);
  }

  var roomDetails = [];
  const assignedRooms = [];

  // Prefetch ONCE per request (mirrors bulkRoomBooking's N+1 fix): the month's
  // allocation priority and the active room blocks overlapping the whole
  // requested window. Blocks are then filtered per range below, because a split
  // stay's segments can overlap different blocks.
  const priorityList =
    shared.priorityList || (await getPriorityOrderForMonth(checkin_date));
  const activeRoomBlocks =
    shared.activeRoomBlocks ||
    (await fetchActiveRoomBlocks(checkin_date, checkout_date));
  const adminBlockedRoomsFor = (start, end) =>
    blockedRoomsInRange(activeRoomBlocks, start, end);

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

        // A card that already holds an overlapping booking cannot take these
        // dates at all. Reported per card so a group booking can say "Rakesh
        // already has a stay" instead of failing for everyone. Decided BEFORE
        // any room is looked for, so such a row reserves no bed, quotes no
        // charge and does not use up credits (the write path never gets here
        // with a clash: it threw above).
        const clashes = overlappingByCard[String(mumukshu)] || [];
        const isAlreadyBooked = clashes.length > 0;

        if (range.isBlocked) {
          // Blocked (centre block, or an overlapping utsav the member is NOT
          // attending): NOT bookable and NOT waitlisted. A block waitlist is a
          // dead-end — no room cron promotes it — so "blocked = unavailable".
          // The write path (bookRoomForMumukshus) throws BEFORE any booking is
          // created when it sees an isBlocked range; here in the shared preview
          // we only surface the flag (roomDetails.isBlocked below) so the client
          // can render the reject. No room is assigned, nothing is charged, and
          // no hold reason is invented (a blocked range never becomes a hold).
        } else if (isAlreadyBooked) {
          // Nothing to allocate or price; the row is reported below with the
          // reason. status stays WAITING with no hold reason (as the flat
          // preview does), which no client renders as a waitlist.
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
              assignedRooms,
              null,
              null,
              priorityList,
              adminBlockedRoomsFor(range.start, range.end)
            );
            if (roomno) {
              status = STATUS_AVAILABLE;
              charge = roomCharge(roomType) / 2;
              availableCredits = usableCredits(tempUser, TYPE_ROOM, charge);
              assignedRoom = roomno.roomno;
              assignedRooms.push(roomno.roomno);
            } else {
              // no bed free for these dates → scarcity waitlist (same reason
              // code the multi-night branch uses, so the row carries a
              // hold_reason instead of NULL)
              status = STATUS_WAITING;
              holdReason = HOLD_REASON.ROOM_UNAVAILABLE;
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
            assignedRooms,
            null,
            null,
            priorityList,
            adminBlockedRoomsFor(range.start, range.end)
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

        let unavailableReason = null;
        if (range.isBlocked) {
          unavailableReason = range.blockedReason || blockedReason;
        } else if (isAlreadyBooked) {
          const clash = clashes[0];
          const span =
            clash.nights === 0 || clash.checkout <= clash.checkin
              ? moment(clash.checkin).format('D MMM')
              : `${moment(clash.checkin).format('D MMM')} to ${moment(
                  clash.checkout
                ).format('D MMM')}`;
          unavailableReason = `You already have a stay booked from ${span}. Cancel it first, or pick dates that do not overlap.`;
        }

        roomDetails.push({
          mumukshu,
          status,
          charge,
          availableCredits,
          holdReason,
          holdReasonMeta,
          // Backend-owned copy for this hold reason. Clients render it directly
          // so a new reason code never needs a client release.
          holdReasonMessage:
            status === STATUS_WAITING && holdReason
              ? (HOLD_REASON_COPY[holdReason] || HOLD_REASON_COPY.UNKNOWN)
                  .userMessage
              : null,
          dates: range.start + ' to ' + range.end,
          range,
          nights,
          roomType,
          floorType,
          gender,
          isBlocked: range.isBlocked || false,
          isAlreadyBooked,
          unavailableReason,
          requiresExtraStayReason: overCapUsage.has(mumukshu) && !isAlreadyBooked,
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
  user,
  preview = false
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

  const overlappingByCard = await getOverlappingFlatBookings(
    checkin_date,
    checkout_date,
    mumukshus
  );
  if (Object.keys(overlappingByCard).length > 0 && !preview) {
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
    // An overlapping flat booking is a hard no, not a waitlist. Reported per card
    // so a group booking names the person who clashes.
    const clashes = overlappingByCard[String(mumukshu)] || [];
    if (clashes.length > 0) {
      const clash = clashes[0];
      const span = `${moment(clash.checkin).format('D MMM')} to ${moment(
        clash.checkout
      ).format('D MMM')}`;
      flatDetails.push({
        mumukshu: mumukshu,
        flatno: flat.flatno,
        nights: nights,
        charge: 0,
        availableCredits: 0,
        status: STATUS_WAITING,
        isAlreadyBooked: true,
        unavailableReason: `You already have a flat stay booked from ${span}. Cancel it first, or pick dates that do not overlap.`
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
        requiresExtraStayReason: true,
        isAlreadyBooked: false,
        unavailableReason: null,
        holdReasonMessage:
          HOLD_REASON_COPY.ROLLING_WINDOW_LIMIT.userMessage,
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
      status: STATUS_AVAILABLE,
      isAlreadyBooked: false,
      unavailableReason: null,
      holdReasonMessage: null
    });
  }

  return flatDetails;
}
