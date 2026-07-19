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
  ERR_ROOM_INVALID_DURATION
} from '../config/constants.js';
import {
  RoomBooking,
  RoomDb,
  FlatBooking,
  FlatDb
} from '../models/associations.js';
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
import Sequelize from 'sequelize';
import ApiError from '../utils/ApiError.js';
import logger from '../config/logger.js';

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
  t
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
      updatedBy
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

export async function findRoom(
  checkin,
  checkout,
  room_type,
  gender,
  excludeRooms = [],
  t = null
) {
  const whereConditions = {
    roomstatus: STATUS_AVAILABLE,
    roomtype: room_type,
    gender: gender,
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

  if (excludeRooms.length > 0) {
    whereConditions[Sequelize.Op.and].push({
      roomno: { [Sequelize.Op.notIn]: excludeRooms }
    });
  }
 
  return RoomDb.findOne({
    attributes: ['roomno'],
    where: whereConditions,
    order: [
      Sequelize.literal(
        `CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED)`
      ),
      Sequelize.literal(`SUBSTRING(roomno, LENGTH(roomno))`)
    ],
    replacements: {
      reqCheckin: checkin,    // Your variable for the requested check-in
      reqCheckout: checkout,  // Your variable for the requested check-out
      excludeStatus1: 'cancelled',           // Statuses that mean the room is actually free
      excludeStatus2: 'admin cancelled'
    },
    transaction: t,
    lock: t ? t.LOCK.UPDATE : undefined,
    limit: 1
  });
}

export async function findAllRooms(checkin, checkout, room_type, gender) {
  const bookings = await RoomBooking.findAll({
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
      status: {
        [Sequelize.Op.notIn]: [STATUS_CANCELLED, STATUS_ADMIN_CANCELLED]
      }
    }
  });
  const bookedRooms = bookings.map((x) => x.roomno);

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
    order: [
      Sequelize.literal(
        `CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED)`
      ),
      Sequelize.literal(`SUBSTRING(roomno, LENGTH(roomno))`)
    ]
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

    if (nights == 0) {
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
  excludeRooms = []
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
  await validateCards(mumukshus);

  if (await checkFlatAlreadyBooked(startDay, endDay, mumukshus)) {
    throw new ApiError(400, ERR_FLAT_ALREADY_BOOKED);
  }

  const nights = await calculateNights(startDay, endDay);
  if (nights > 9) {
    throw new ApiError(400, ERR_ROOM_INVALID_DURATION);
  }

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
      t
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
  cashAllowed = false
) {
  let bookingId = uuidv4();

  let status = STATUS_PAYMENT_PENDING;

  const mumukshuIsFlatOwner = await isMumukshuFlatOwner(cardno, flatno);
  if (mumukshuIsFlatOwner) {
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
      status
    },
    { transaction: t }
  );

  if (!booking) {
    throw new ApiError(400, ERR_FLAT_FAILED_TO_BOOK);
  }

  let discountedAmount = 0;
  if (!mumukshuIsFlatOwner) {
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

  const nights = await calculateNights(checkin_date, checkout_date);
  if (nights > 9) {
    throw new ApiError(400, ERR_ROOM_INVALID_DURATION);
  }

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
      const gender = floorType ? floorType + card.gender : card.gender;

      const dateRanges = dateRangesByMumukshu[mumukshu];
      for (const range of dateRanges) {
        var status = STATUS_WAITING;
        var charge = 0;
        var availableCredits = 0;
        var assignedRoom = null;

        const nights = await calculateNights(range.start, range.end);
        const minNights = range.overlappingWithUtsav && nights > 0 ? 1 : 0;

        if (range.isBlocked) {
          // Keep waiting status, do not assign room or charge
        } else if (nights == 0) {
          // 1 day visit
          status = STATUS_AVAILABLE;
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
