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
  ERR_FLAT_FAILED_TO_BOOK
} from '../config/constants.js';
import {
  RoomBooking,
  RoomDb,
  UtsavDb,
  FlatBooking,
  FlatDb
} from '../models/associations.js';
import { createPendingTransaction } from './transactions.helper.js';
import { calculateNights, validateDate } from '../controllers/helper.js';
import { v4 as uuidv4 } from 'uuid';
import { validateCards } from './card.helper.js';
import Sequelize from 'sequelize';
import ApiError from '../utils/ApiError.js';
import { usableCredits } from './transactions.helper.js';
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

export async function findRoom(checkin, checkout, room_type, gender) {
  return RoomDb.findOne({
    attributes: ['roomno'],
    where: {
      roomno: {
        [Sequelize.Op.notLike]: 'NA%',
        [Sequelize.Op.notLike]: 'WL%',
        [Sequelize.Op.notIn]: Sequelize.literal(`(
                    SELECT roomno 
                    FROM room_booking 
                    WHERE NOT (checkout <= '${checkin}' OR checkin >= '${checkout}')
                    AND status NOT IN ('${STATUS_CANCELLED}', '${STATUS_ADMIN_CANCELLED}')
                )`)
      },
      roomstatus: STATUS_AVAILABLE,
      roomtype: room_type,
      gender: gender
    },
    order: [
      Sequelize.literal(
        `CAST(SUBSTRING(roomno, 1, LENGTH(roomno) - 1) AS UNSIGNED)`
      ),
      Sequelize.literal(`SUBSTRING(roomno, LENGTH(roomno))`)
    ],
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
  user
) {
  validateDate(checkin_date, checkout_date);

  const mumukshus = mumukshuGroup.flatMap(
    (group) => group.mumukshus || group.guests
  );
  const cardDb = await validateCards(mumukshus);

  if (await checkRoomAlreadyBooked(checkin_date, checkout_date, ...mumukshus)) {
    throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
  }

  const nights = await calculateNights(checkin_date, checkout_date);

  let amount = 0;
  let userBookingIds = {};
  for (const group of mumukshuGroup) {
    const { roomType, floorType } = group;
    const mumukshus = group.mumukshus || group.guests;

    for (const mumukshu of mumukshus) {
      const card = cardDb.filter((item) => item.cardno == mumukshu)[0];
      const bookedBy = card.cardno == user.cardno ? null : user.cardno;

      if (nights == 0) {
        const result = await bookDayVisit(
          card.cardno,
          checkin_date,
          checkout_date,
          bookedBy,
          user.cardno,
          t
        );
        userBookingIds[card.cardno] = [result.bookingid];
      } else {
        const result = await createRoomBooking(
          card.cardno,
          checkin_date,
          checkout_date,
          nights,
          roomType,
          card.gender,
          floorType,
          user,
          t
        );

        amount += result.discountedAmount;
        userBookingIds[card.cardno] = [result.bookingId];
      }
    }
  }
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
  cashAllowed = false
) {
  const gender = floor_pref ? floor_pref + user_gender : user_gender;

  // If this is a single-night booking that begins on the Utsav end date
  // OR ends on the Utsav start date,
  // we should mark the booking as WAITING instead of creating a normal booking.
  // This handles the scenario: check-in = utsav.end_date, check-out = utsav.end_date + 1 day.
  const isSingleNight = nights === 1;
  if (isSingleNight) {
    // Find an Utsav whose end_date is the same as the check-in date.
    const utsavEndingToday = await UtsavDb.findOne({
      where: { end_date: checkin }
    });
    const utsavStartingTomorrow = await UtsavDb.findOne({
      where: { start_date: checkout }
    });
    if (utsavEndingToday || utsavStartingTomorrow) {
      const bookedBy = user.cardno !== cardno ? user.cardno : null;
      let bookingId = uuidv4();
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
          updatedBy: user.cardno
        },
        { transaction: t }
      );
      return { t, discountedAmount: 0, bookingId };
    }
  }
  const roomno = await findRoom(checkin, checkout, roomtype, gender);
  const bookedBy = user.cardno !== cardno ? user.cardno : null;

  if (!roomno) {
    throw new ApiError(400, ERR_ROOM_NO_BED_AVAILABLE);
  }
  let bookingId = uuidv4();
  const booking = await RoomBooking.create(
    {
      bookingid: bookingId,
      roomno: roomno.dataValues.roomno,
      status: STATUS_PAYMENT_PENDING,
      cardno,
      bookedBy,
      checkin,
      checkout,
      nights,
      roomtype,
      gender,
      updatedBy: user.cardno
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
    user.cardno,
    t,
    cashAllowed
  );

  if (!transaction) {
    throw new ApiError(400, ERR_ROOM_FAILED_TO_BOOK);
  }

  return { t, discountedAmount, bookingId };
}

export function roomCharge(roomtype) {
  return roomtype == 'nac' ? NAC_ROOM_PRICE : AC_ROOM_PRICE;
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
  // let status = cashAllowed
  //   ? STATUS_CASH_PENDING
  //   : STATUS_PAYMENT_PENDING;

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

export async function checkRoomAvailabilityDuringUtsav(
  checkin_date,
  checkout_date,
  roomType,
  gender,
  utsav,
  mumkshu,
  user
) {
  var roomDetails = [];
  const event_start_date = utsav.start_date;
  const event_end_date = utsav.end_date;
  let statusValue = STATUS_WAITING;
  let charge = 0;
  let availableCredits = 0;

  if (new Date(checkin_date) < new Date(event_start_date)) {
    const beforeNights = await calculateNights(checkin_date, event_start_date);

    if (beforeNights > 0) {
      if (beforeNights == 1) {
        roomDetails.push({
          mumukshu: mumkshu,
          status: STATUS_WAITING,
          charge: 0,
          dates: checkin_date + ' to ' + event_start_date
        });
      } else {
        const roomno = await findRoom(
          checkin_date,
          event_start_date,
          roomType,
          gender
        );
        if (roomno) {
          statusValue = STATUS_AVAILABLE;
          charge = roomCharge(roomType) * beforeNights;
          availableCredits = usableCredits(user, TYPE_ROOM, charge);
        }
        roomDetails.push({
          mumukshu: mumkshu,
          status: statusValue,
          charge: charge,
          availableCredits: availableCredits,
          dates: checkin_date + ' to ' + event_start_date
        });
      }
    }
  }

  availableCredits = 0;
  charge = 0;
  statusValue = STATUS_WAITING;
  // Handle booking after event ends
  if (new Date(checkout_date) > new Date(event_end_date)) {
    const afterNights = await calculateNights(event_end_date, checkout_date);

    if (afterNights > 0) {
      const roomno = await findRoom(
        event_end_date,
        checkout_date,
        roomType,
        gender
      );

      if (roomno) {
        statusValue = STATUS_AVAILABLE;

        charge = roomCharge(roomType) * afterNights;
        availableCredits = usableCredits(user, TYPE_ROOM, charge);
      }

      roomDetails.push({
        mumukshu: mumkshu,
        status: statusValue,
        charge: charge,
        availableCredits: availableCredits,
        dates: event_end_date + ' to ' + checkout_date
      });
    }
  }
  return roomDetails;
}

export async function checkRoomAvailabilityForMumukshus(
  checkin_date,
  checkout_date,
  mumukshuGroup,
  user,
  utsav
) {
  validateDate(checkin_date, checkout_date);

  let nights = await calculateNights(checkin_date, checkout_date);
  const mumukshus = mumukshuGroup.flatMap(
    (group) => group.mumukshus || group.guests
  );
  const cardDb = await validateCards(mumukshus);

  if (await checkRoomAlreadyBooked(checkin_date, checkout_date, ...mumukshus)) {
    throw new ApiError(400, ERR_ROOM_ALREADY_BOOKED);
  }

  var roomDetails = [];
  for (const group of mumukshuGroup) {
    const { roomType, floorType } = group;
    const mumukshus = group.mumukshus || group.guests;

    for (const mumukshu of mumukshus) {
      const card = cardDb.filter(
        (item) => item.dataValues.cardno == mumukshu
      )[0];

      const gender = floorType
        ? floorType + card.dataValues.gender
        : card.dataValues.gender;

      if (utsav) {
        roomDetails.push(
          ...(await checkRoomAvailabilityDuringUtsav(
            checkin_date,
            checkout_date,
            roomType,
            gender,
            utsav,
            mumukshu,
            user
          ))
        );
      } else {
        var status = STATUS_WAITING;
        var charge = 0;
        var availableCredits = 0;

        if (nights > 0) {
          const roomno = await findRoom(
            checkin_date,
            checkout_date,
            roomType,
            gender
          );
          if (roomno) {
            status = STATUS_AVAILABLE;
            charge = roomCharge(roomType) * nights;
            availableCredits = usableCredits(user, TYPE_ROOM, charge);
          }
        } else {
          status = STATUS_AVAILABLE;
        }

        roomDetails.push({
          mumukshu,
          status,
          charge,
          availableCredits
        });
      }
    }
  }

  return roomDetails;
}
