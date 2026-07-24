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
  ERR_ROOM_INVALID_DURATION,
  STATUS_AWAITING_CONFIRMATION,
  ROLLING_WINDOW_DAYS,
  ROLLING_WINDOW_NIGHT_LIMIT,
  ROLLING_WINDOW_GO_LIVE_DATE,
  ERR_EXTRA_STAY_REASON_REQUIRED,
  STATUS_RESIDENT,
  STATUS_SEVA_KUTIR
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
  validateDate
} from '../controllers/helper.js';
import {
  findUtsavOnBoundaryDates,
  getDateRangesDuringUtsav
} from './utsavBooking.helper.js';
import { v4 as uuidv4 } from 'uuid';
import { validateCards } from './card.helper.js';
import moment from 'moment';
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
  t
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
      updatedBy
    },
    { transaction: t }
  );
  return { t, discountedAmount: 0, bookingId, bookedRoomNo: 'NA' };
}

export async function bookAwaitingConfirmationRoom(
  cardno,
  checkin,
  checkout,
  nights,
  roomtype,
  gender,
  extra_stay_reason,
  bookedBy,
  updatedBy,
  t
) {
  const bookingId = uuidv4();
  const effectiveCheckout = checkin === checkout
    ? moment(checkin).add(1, 'day').format('YYYY-MM-DD')
    : checkout;

  await RoomBooking.create(
    {
      bookingid: bookingId,
      roomno: 'NA',
      status: STATUS_AWAITING_CONFIRMATION,
      extra_stay_reason,
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
  return { t, discountedAmount: 0, bookingId, bookedRoomNo: 'NA' };
}

export function getEffectiveNights(booking) {
  const nights = Number(booking.nights || 0);
  const roomtype = booking.roomtype || 'NA';
  if (nights === 0 && roomtype === 'NA') return 0;
  if (nights === 0 && roomtype !== 'NA') return 1;
  return nights;
}

export function expandToNightDates(checkinDate, effectiveNights) {
  const dates = [];
  if (effectiveNights <= 0 || !checkinDate) return dates;
  const start = moment(checkinDate);
  for (let i = 0; i < effectiveNights; i++) {
    dates.push(start.clone().add(i, 'days').format('YYYY-MM-DD'));
  }
  return dates;
}

export async function validateBookingLimits(
  cardno,
  newCheckin,
  newCheckout,
  newRoomtype = 'nac',
  t = null,
  priorNightDates = []
) {
  // 1. Check if cardno is Resident / Staff
  const card = await CardDb.findOne({
    where: { cardno },
    attributes: ['cardno', 'res_status'],
    transaction: t
  });
  if (card && [STATUS_RESIDENT, STATUS_SEVA_KUTIR, 'Resident', 'Staff'].includes(card.res_status)) {
    return { passed: true };
  }

  // 2. Check room_booking_exemptions for an active bypass record
  const checkinDate = newCheckin || moment().format('YYYY-MM-DD');
  const checkoutDate = newCheckout || checkinDate;

  const exemption = await RoomBookingExemption.findOne({
    where: {
      cardno,
      [Sequelize.Op.or]: [
        { is_permanent: true },
        {
          [Sequelize.Op.and]: [
            { valid_from: { [Sequelize.Op.lte]: checkinDate } },
            { valid_to: { [Sequelize.Op.gte]: checkoutDate } }
          ]
        }
      ]
    },
    transaction: t
  });
  if (exemption) {
    return { passed: true, isExempt: true };
  }

  // 3. Phase 1: Check single stay duration
  const singleStayNights = getEffectiveNights({
    nights: calculateNightsSingleStay(newCheckin, newCheckout),
    roomtype: newRoomtype
  });
  if (singleStayNights > ROLLING_WINDOW_NIGHT_LIMIT) {
    return {
      passed: false,
      reasonType: 'single_stay_exceeded',
      limit: ROLLING_WINDOW_NIGHT_LIMIT,
      requestedNights: singleStayNights,
      message: `Single stay of ${singleStayNights} nights exceeds the 9-night limit.`
    };
  }

  // 4. Phase 2: Rolling 30-day window check
  const goLiveDate = ROLLING_WINDOW_GO_LIVE_DATE;
  const whereCondition = {
    cardno,
    status: {
      [Sequelize.Op.notIn]: [STATUS_CANCELLED, STATUS_ADMIN_CANCELLED, STATUS_WAITING]
    }
  };
  if (goLiveDate) {
    whereCondition.checkout = { [Sequelize.Op.gte]: goLiveDate };
  }

  const roomBookings = await RoomBooking.findAll({
    where: whereCondition,
    attributes: ['checkin', 'checkout', 'nights', 'roomtype'],
    transaction: t
  });

  const flatBookings = await FlatBooking.findAll({
    where: whereCondition,
    attributes: ['checkin', 'checkout', 'nights'],
    transaction: t
  });

  // Expand existing bookings into individual night dates
  const existingNightDatesSet = new Set();
  for (const b of roomBookings) {
    const effNights = getEffectiveNights(b);
    const dates = expandToNightDates(b.checkin, effNights);
    dates.forEach((d) => existingNightDatesSet.add(d));
  }
  for (const fb of flatBookings) {
    const effNights = fb.nights || 0;
    const dates = expandToNightDates(fb.checkin, effNights);
    dates.forEach((d) => existingNightDatesSet.add(d));
  }

  // Expand proposed new booking into night dates
  const proposedNightDates = expandToNightDates(newCheckin, singleStayNights);

  // Combine into single set of unique dates
  const combinedSet = new Set([...existingNightDatesSet, ...priorNightDates, ...proposedNightDates]);

  // Determine window scanning range
  const windowStartRangeBegin = moment(newCheckin).subtract(ROLLING_WINDOW_DAYS - 1, 'days');
  const windowStartRangeEnd = moment(
    newCheckout > newCheckin ? moment(newCheckout).subtract(1, 'day') : newCheckin
  );

  let limitExceeded = false;
  let violatingWindowStart = null;
  let violatingWindowEnd = null;
  let maxNightsInWindow = 0;

  const currentMoment = windowStartRangeBegin.clone();
  while (currentMoment.isSameOrBefore(windowStartRangeEnd)) {
    const wStartStr = currentMoment.format('YYYY-MM-DD');
    const wEndStr = currentMoment
      .clone()
      .add(ROLLING_WINDOW_DAYS - 1, 'days')
      .format('YYYY-MM-DD');

    let countInWindow = 0;
    combinedSet.forEach((dateStr) => {
      if (dateStr >= wStartStr && dateStr <= wEndStr) {
        countInWindow++;
      }
    });

    if (countInWindow > maxNightsInWindow) {
      maxNightsInWindow = countInWindow;
    }

    if (countInWindow > ROLLING_WINDOW_NIGHT_LIMIT && !limitExceeded) {
      limitExceeded = true;
      violatingWindowStart = wStartStr;
      violatingWindowEnd = wEndStr;
    }

    currentMoment.add(1, 'day');
  }

  const existingNightsUsed = existingNightDatesSet.size;
  const nightsRemaining = Math.max(0, ROLLING_WINDOW_NIGHT_LIMIT - existingNightsUsed);

  if (limitExceeded) {
    return {
      passed: false,
      reasonType: 'rolling_limit_exceeded',
      limit: ROLLING_WINDOW_NIGHT_LIMIT,
      nightsUsed: existingNightsUsed,
      maxNightsInWindow,
      nightsRemaining,
      windowStart: violatingWindowStart,
      windowEnd: violatingWindowEnd,
      message: `Stay exceeds 9 nights in rolling window (${violatingWindowStart} to ${violatingWindowEnd}).`
    };
  }

  return {
    passed: true,
    nightsUsed: existingNightsUsed,
    nightsRemaining
  };
}

function calculateNightsSingleStay(checkin, checkout) {
  if (!checkin || !checkout) return 0;
  if (checkin === checkout) return 0;
  const diff = moment(checkout).diff(moment(checkin), 'days');
  return Math.max(0, diff);
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
  const monthNum = checkinDate ? moment(checkinDate).month() + 1 : null;
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
  return rec.priority_order.split(',').map((s) => s.trim());
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

  return [
    Sequelize.literal(`
      CASE 
        WHEN CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED) BETWEEN 1 AND 18 THEN ${oag1Index}
        WHEN CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED) BETWEEN 19 AND 36 THEN ${oag2Index}
        WHEN CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED) BETWEEN 37 AND 48 THEN ${nag1Index}
        WHEN CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED) BETWEEN 49 AND 60 THEN ${nag2Index}
        ELSE 99
      END ASC
    `),
    Sequelize.literal(`CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED) ASC`),
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
  floorPref = null
) {
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

  const priorityList = await getPriorityOrderForMonth(checkin);
  const orderClause = buildPriorityOrderClause(priorityList, isGroundPref);

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

  const roomDetails = await checkRoomAvailabilityForMumukshus(
    checkin_date,
    checkout_date,
    mumukshuGroup,
    user,
    utsav
  );

  let amount = 0;
  const userBookingIds = {};
  const assignedRooms = [];
  const updatedBy = user.cardno;

  for (const roomDetail of roomDetails) {
    const { mumukshu, status, range, nights, roomno, roomType, gender } =
      roomDetail;

    const card = cardDb.filter((item) => item.cardno == mumukshu)[0];
    const bookedBy = card.cardno == user.cardno ? null : user.cardno;

    userBookingIds[card.cardno] = userBookingIds[card.cardno] || [];

    if (status === STATUS_AWAITING_CONFIRMATION) {
      if (!extra_stay_reason || !extra_stay_reason.trim()) {
        throw new ApiError(400, ERR_EXTRA_STAY_REASON_REQUIRED);
      }
      const result = await bookAwaitingConfirmationRoom(
        card.cardno,
        range.start,
        range.end,
        nights,
        roomType,
        gender,
        extra_stay_reason,
        bookedBy,
        updatedBy,
        t
      );
      userBookingIds[card.cardno].push(result.bookingId);
    } else if (nights == 0) {
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
  extra_stay_reason = null
) {
  const gender = floor_pref ? floor_pref + user_gender : user_gender;
  const bookedBy = user.cardno !== cardno ? user.cardno : null;

  const limitCheck = await validateBookingLimits(cardno, checkin, checkout, roomtype, t);
  if (!limitCheck.passed) {
    if (!extra_stay_reason || !extra_stay_reason.trim()) {
      throw new ApiError(400, ERR_EXTRA_STAY_REASON_REQUIRED);
    }
    return bookAwaitingConfirmationRoom(
      cardno,
      checkin,
      checkout,
      nights,
      roomtype,
      gender,
      extra_stay_reason,
      bookedBy,
      user.cardno,
      t
    );
  }

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
        t
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
    t
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
  await validateCards(mumukshus);

  if (await checkFlatAlreadyBooked(startDay, endDay, mumukshus)) {
    throw new ApiError(400, ERR_FLAT_ALREADY_BOOKED);
  }

  const nights = await calculateNights(startDay, endDay);
  const userBookingIds = {},
    bookingIds = [];
  let amount = 0;

  for (var mumukshu of mumukshus) {
    const isOwner = await isMumukshuFlatOwner(mumukshu, flat.flatno);
    let overrideStatus = null;

    if (!isOwner) {
      const limitCheck = await validateBookingLimits(mumukshu, startDay, endDay, 'nac', t);
      if (!limitCheck.passed) {
        if (!extra_stay_reason || !extra_stay_reason.trim()) {
          throw new ApiError(400, ERR_EXTRA_STAY_REASON_REQUIRED);
        }
        overrideStatus = STATUS_AWAITING_CONFIRMATION;
      }
    }

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
      overrideStatus,
      extra_stay_reason
    );
    amount += booking.discountedAmount;
    userBookingIds[mumukshu] = [booking.bookingId];
    bookingIds.push(booking.bookingId);
  }

  var order = null;
  if (createOrder && user.country == 'India' && amount > 0) {
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
  overrideStatus = null,
  extra_stay_reason = null
) {
  let bookingId = uuidv4();

  let status = overrideStatus || STATUS_PAYMENT_PENDING;

  const mumukshuIsFlatOwner = await isMumukshuFlatOwner(cardno, flatno);
  if (!overrideStatus && mumukshuIsFlatOwner) {
    status = ROOM_STATUS_PENDING_CHECKIN;
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
      extra_stay_reason
    },
    { transaction: t }
  );

  if (!booking) {
    throw new ApiError(400, ERR_FLAT_FAILED_TO_BOOK);
  }

  let discountedAmount = 0;
  if (!mumukshuIsFlatOwner && status !== STATUS_AWAITING_CONFIRMATION) {
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
  utsav
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

  // Create a temp user with cloned credits to track usage during this validation loop
  // without mutating the original user object.
  const tempUser = { ...user, credits: { ...user.credits } };

  var roomDetails = [];
  const assignedRooms = [];

  for (const group of mumukshuGroup) {
    const { roomType, floorType } = group;
    const mumukshus = group.mumukshus || group.guests;

    for (const mumukshu of mumukshus) {
      const card = cardDb.filter((item) => item.cardno == mumukshu)[0];
      const gender = floorType === 'SC' ? 'SC' + card.gender : card.gender;

      const dateRanges = dateRangesByMumukshu[mumukshu];
      const accumulatedPriorNightDates = [];

      for (const range of dateRanges) {
        var status = STATUS_WAITING;
        var charge = 0;
        var availableCredits = 0;
        var assignedRoom = null;

        const limitCheck = await validateBookingLimits(
          mumukshu,
          range.start,
          range.end,
          roomType,
          null,
          accumulatedPriorNightDates
        );

        const nights = await calculateNights(range.start, range.end);
        const minNights = range.overlappingWithUtsav && nights > 0 ? 1 : 0;

        if (!limitCheck.passed) {
          status = STATUS_AWAITING_CONFIRMATION;
        } else if (range.isBlocked) {
          // Keep waiting status, do not assign room or charge
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
          }
        }

        const rangeNightDates = expandToNightDates(range.start, nights);
        accumulatedPriorNightDates.push(...rangeNightDates);

        roomDetails.push({
          mumukshu,
          status,
          charge,
          availableCredits,
          dates: range.start + ' to ' + range.end,
          range,
          nights,
          roomType,
          gender,
          isBlocked: range.isBlocked || false,
          requiresExtraStayReason: !limitCheck.passed,
          limitCheckInfo: limitCheck,
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
  await validateCards(mumukshus);

  if (await checkFlatAlreadyBooked(checkin_date, checkout_date, mumukshus)) {
    throw new ApiError(400, ERR_FLAT_ALREADY_BOOKED);
  }

  const nights = await calculateNights(checkin_date, checkout_date);
  if (nights > 9) {
    throw new ApiError(400, ERR_ROOM_INVALID_DURATION);
  }
  const flatDetails = [];

  const flatOwnerData = await FlatDb.findAll({
    where: {
      owner: mumukshus
    }
  });

  // Create a temp user with cloned credits to track usage during this validation loop without mutating the original user object.
  const tempUser = { ...user, credits: { ...user.credits } };

  for (const mumukshu of mumukshus) {
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
